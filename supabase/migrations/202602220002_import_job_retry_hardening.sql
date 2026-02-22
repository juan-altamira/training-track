-- Hardens import job retries and stale-processing behavior:
-- - Adds bounded retries to avoid infinite re-claim loops.
-- - Persists last known error metadata independently of current error state.
-- - Expires stale processing jobs during purge when lease is already expired.

alter table public.import_jobs
	add column if not exists max_attempts integer not null default 5 check (max_attempts >= 1);

alter table public.import_jobs
	add column if not exists last_error_code text;

alter table public.import_jobs
	add column if not exists last_error_message text;

alter table public.import_jobs
	add column if not exists last_error_at timestamptz;

create or replace function public.track_import_job_last_error()
returns trigger
language plpgsql
as $$
begin
	if new.error_code is not null then
		if tg_op = 'INSERT'
			or new.error_code is distinct from old.error_code
			or new.error_message is distinct from old.error_message then
			new.last_error_code := new.error_code;
			new.last_error_message := new.error_message;
			new.last_error_at := now();
		end if;
	end if;

	return new;
end;
$$;

drop trigger if exists trg_import_jobs_track_last_error on public.import_jobs;
create trigger trg_import_jobs_track_last_error
	before insert or update on public.import_jobs
	for each row
	execute function public.track_import_job_last_error();

create or replace function public.claim_import_jobs(
	p_worker_id text,
	p_limit integer default 3,
	p_lease_seconds integer default 180
)
returns setof public.import_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
	v_limit integer := greatest(1, least(coalesce(p_limit, 3), 20));
	v_lease_seconds integer := greatest(30, least(coalesce(p_lease_seconds, 180), 900));
begin
	update public.import_jobs as j
	set
		status = 'failed',
		progress_stage = 'failed',
		progress_percent = 100,
		lease_owner = null,
		lease_expires_at = null,
		error_code = 'max_attempts_exceeded',
		error_message = format('Se alcanzó el máximo de reintentos (%s).', j.max_attempts),
		updated_at = now()
	where (
		j.status = 'queued'
		or (j.status = 'processing' and (j.lease_expires_at is null or j.lease_expires_at < now()))
	)
		and (j.expires_at is null or j.expires_at > now())
		and j.attempts >= j.max_attempts;

	return query
	with candidates as (
		select j.id
		from public.import_jobs as j
		where (
			j.status = 'queued'
			or (j.status = 'processing' and (j.lease_expires_at is null or j.lease_expires_at < now()))
		)
			and (j.expires_at is null or j.expires_at > now())
			and j.attempts < j.max_attempts
		order by j.created_at asc
		for update skip locked
		limit v_limit
	),
	claimed as (
		update public.import_jobs as j
		set
			status = 'processing',
			attempts = j.attempts + 1,
			lease_owner = p_worker_id,
			lease_expires_at = now() + make_interval(secs => v_lease_seconds),
			progress_stage = 'processing',
			progress_percent = greatest(j.progress_percent, 1),
			error_code = null,
			error_message = null,
			updated_at = now()
		where j.id in (select id from candidates)
		returning j.*
	)
	select *
	from claimed;
end;
$$;

create or replace function public.purge_import_data()
returns table (
	artifacts_deleted integer,
	jobs_expired integer,
	jobs_deleted integer,
	backups_deleted integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
	v_artifacts_deleted integer := 0;
	v_jobs_expired integer := 0;
	v_jobs_expired_processing integer := 0;
	v_jobs_deleted integer := 0;
	v_backups_deleted integer := 0;
begin
	delete from public.import_job_artifacts
	where expires_at is not null
		and expires_at < now();
	get diagnostics v_artifacts_deleted = row_count;

	update public.import_jobs
	set
		status = 'expired',
		progress_stage = 'expired',
		lease_owner = null,
		lease_expires_at = null
	where status in ('queued', 'ready', 'failed')
		and expires_at is not null
		and expires_at < now();
	get diagnostics v_jobs_expired = row_count;

	update public.import_jobs
	set
		status = 'expired',
		progress_stage = 'expired',
		lease_owner = null,
		lease_expires_at = null
	where status = 'processing'
		and expires_at is not null
		and expires_at < now()
		and (lease_expires_at is null or lease_expires_at < now());
	get diagnostics v_jobs_expired_processing = row_count;
	v_jobs_expired := v_jobs_expired + v_jobs_expired_processing;

	delete from public.import_jobs
	where status in ('expired', 'failed', 'rolled_back')
		and created_at < (now() - interval '30 days');
	get diagnostics v_jobs_deleted = row_count;

	with ranked as (
		select
			id,
			client_id,
			created_at,
			row_number() over (partition by client_id order by created_at desc) as rn
		from public.routine_backups
	),
	to_delete as (
		select id
		from ranked
		where rn > 20
			or created_at < (now() - interval '30 days')
	)
	delete from public.routine_backups rb
	using to_delete d
	where rb.id = d.id;
	get diagnostics v_backups_deleted = row_count;

	return query
	select v_artifacts_deleted, v_jobs_expired, v_jobs_deleted, v_backups_deleted;
end;
$$;

revoke execute on function public.claim_import_jobs(text, integer, integer)
from public, anon, authenticated;
revoke execute on function public.purge_import_data()
from public, anon, authenticated;

grant execute on function public.claim_import_jobs(text, integer, integer) to service_role;
grant execute on function public.purge_import_data() to service_role;
