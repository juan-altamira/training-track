-- Import routines V1.1 foundation:
-- - Async jobs with lease
-- - Draft + issues persistence
-- - Atomic commit with optimistic lock + backup
-- - Rollback + purge helpers
-- - Security hardening (service-role only mutation/read path by default)

create extension if not exists pgcrypto;

do $$
begin
	if not exists (select 1 from pg_type where typname = 'import_job_status') then
		create type public.import_job_status as enum (
			'queued',
			'processing',
			'ready',
			'failed',
			'committing',
			'committed',
			'rolled_back',
			'expired'
		);
	end if;

	if not exists (select 1 from pg_type where typname = 'import_source_type') then
		create type public.import_source_type as enum ('text', 'csv', 'xlsx', 'docx', 'pdf');
	end if;

	if not exists (select 1 from pg_type where typname = 'import_job_scope') then
		create type public.import_job_scope as enum ('client', 'template');
	end if;

	if not exists (select 1 from pg_type where typname = 'import_commit_policy') then
		create type public.import_commit_policy as enum ('overwrite_all', 'overwrite_days');
	end if;

	if not exists (select 1 from pg_type where typname = 'import_issue_severity') then
		create type public.import_issue_severity as enum (
			'hard_error',
			'needs_review_blocking',
			'needs_review',
			'warning',
			'autofix_applied'
		);
	end if;
end
$$;

create table if not exists public.import_jobs (
	id uuid primary key default gen_random_uuid(),
	trainer_id uuid not null references public.trainers(id) on delete cascade,
	client_id uuid references public.clients(id) on delete cascade,
	scope public.import_job_scope not null default 'client',
	status public.import_job_status not null default 'queued',
	source_type public.import_source_type not null,
	file_hash_sha256 text not null,
	storage_path text,
	file_meta jsonb not null default '{}'::jsonb,
	parser_version text not null,
	ruleset_version text not null,
	extractor_version text not null,
	ocr_engine_version text,
	llm_model_version text,
	prompt_version text,
	attempts integer not null default 0 check (attempts >= 0),
	lease_owner text,
	lease_expires_at timestamptz,
	progress_stage text not null default 'queued',
	progress_percent integer not null default 0 check (progress_percent between 0 and 100),
	error_code text,
	error_message text,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	expires_at timestamptz
);

create table if not exists public.import_job_artifacts (
	job_id uuid primary key references public.import_jobs(id) on delete cascade,
	payload_base64 text not null,
	mime_type text,
	file_name text,
	created_at timestamptz not null default now(),
	expires_at timestamptz
);

create table if not exists public.import_drafts (
	job_id uuid primary key references public.import_jobs(id) on delete cascade,
	draft_json jsonb not null,
	issues_json jsonb not null default '[]'::jsonb,
	derived_routineplan_json jsonb not null,
	stats_json jsonb not null default '{}'::jsonb,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create table if not exists public.routine_backups (
	id uuid primary key default gen_random_uuid(),
	client_id uuid not null references public.clients(id) on delete cascade,
	plan jsonb not null,
	routine_version bigint not null,
	reason text not null,
	created_by uuid,
	created_at timestamptz not null default now()
);

create table if not exists public.import_commits (
	id uuid primary key default gen_random_uuid(),
	job_id uuid not null references public.import_jobs(id) on delete cascade,
	trainer_id uuid not null references public.trainers(id) on delete cascade,
	client_id uuid not null references public.clients(id) on delete cascade,
	policy public.import_commit_policy not null,
	overwrite_days text[],
	routine_version_before bigint not null,
	routine_version_after bigint not null,
	backup_id uuid not null references public.routine_backups(id) on delete restrict,
	commit_idempotency_key text not null unique,
	created_at timestamptz not null default now()
);

create table if not exists public.import_audit (
	id uuid primary key default gen_random_uuid(),
	job_id uuid not null references public.import_jobs(id) on delete cascade,
	trainer_id uuid not null references public.trainers(id) on delete cascade,
	client_id uuid references public.clients(id) on delete set null,
	event text not null,
	payload jsonb not null default '{}'::jsonb,
	created_at timestamptz not null default now()
);

create table if not exists public.import_tenant_limits (
	trainer_id uuid primary key references public.trainers(id) on delete cascade,
	monthly_ocr_pages_quota integer not null default 0 check (monthly_ocr_pages_quota >= 0),
	monthly_llm_pages_quota integer not null default 0 check (monthly_llm_pages_quota >= 0),
	kill_switch boolean not null default false,
	updated_at timestamptz not null default now()
);

create index if not exists idx_import_jobs_status_created_at
	on public.import_jobs (status, created_at);

create index if not exists idx_import_jobs_trainer_created_at
	on public.import_jobs (trainer_id, created_at desc);

create index if not exists idx_import_jobs_hash_versions
	on public.import_jobs (
		file_hash_sha256,
		parser_version,
		ruleset_version,
		extractor_version
	);

create index if not exists idx_import_jobs_lease_expires
	on public.import_jobs (lease_expires_at);

create index if not exists idx_import_jobs_expires_at
	on public.import_jobs (expires_at);

create index if not exists idx_routine_backups_client_created_at
	on public.routine_backups (client_id, created_at desc);

create index if not exists idx_import_audit_job_created_at
	on public.import_audit (job_id, created_at desc);

alter table public.routines
	add column if not exists version bigint not null default 1;

create index if not exists idx_routines_client_version
	on public.routines (client_id, version);

create or replace function public.set_import_jobs_updated_at()
returns trigger
language plpgsql
as $$
begin
	new.updated_at = now();
	return new;
end;
$$;

drop trigger if exists trg_import_jobs_updated_at on public.import_jobs;
create trigger trg_import_jobs_updated_at
	before update on public.import_jobs
	for each row
	execute function public.set_import_jobs_updated_at();

create or replace function public.set_import_drafts_updated_at()
returns trigger
language plpgsql
as $$
begin
	new.updated_at = now();
	return new;
end;
$$;

drop trigger if exists trg_import_drafts_updated_at on public.import_drafts;
create trigger trg_import_drafts_updated_at
	before update on public.import_drafts
	for each row
	execute function public.set_import_drafts_updated_at();

create or replace function public.bump_routine_version_on_plan_change()
returns trigger
language plpgsql
as $$
begin
	if tg_op = 'INSERT' then
		if new.version is null then
			new.version := 1;
		end if;
		return new;
	end if;

	if new.plan is distinct from old.plan then
		new.version := old.version + 1;
	else
		new.version := old.version;
	end if;
	return new;
end;
$$;

drop trigger if exists trg_routines_bump_version_on_plan_change on public.routines;
create trigger trg_routines_bump_version_on_plan_change
	before insert or update on public.routines
	for each row
	execute function public.bump_routine_version_on_plan_change();

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
	return query
	with candidates as (
		select j.id
		from public.import_jobs as j
		where (
			j.status = 'queued'
			or (j.status = 'processing' and (j.lease_expires_at is null or j.lease_expires_at < now()))
		)
			and (j.expires_at is null or j.expires_at > now())
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

create or replace function public.apply_import_commit(
	p_job_id uuid,
	p_trainer_id uuid,
	p_client_id uuid,
	p_policy public.import_commit_policy,
	p_overwrite_days text[],
	p_routine_version_expected bigint,
	p_commit_idempotency_key text,
	p_next_plan jsonb
)
returns table (
	commit_id uuid,
	routine_version_after bigint,
	backup_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
	v_existing_commit public.import_commits%rowtype;
	v_job public.import_jobs%rowtype;
	v_routine_row public.routines%rowtype;
	v_target_plan jsonb;
	v_backup_id uuid;
	v_commit_id uuid;
	v_routine_version_after bigint;
	v_day text;
	v_valid_days text[] := array['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
begin
	if p_commit_idempotency_key is null or btrim(p_commit_idempotency_key) = '' then
		raise exception 'commit_idempotency_key is required';
	end if;

	select *
	into v_existing_commit
	from public.import_commits
	where commit_idempotency_key = p_commit_idempotency_key;

	if found then
		return query
		select v_existing_commit.id, v_existing_commit.routine_version_after, v_existing_commit.backup_id;
		return;
	end if;

	select *
	into v_job
	from public.import_jobs
	where id = p_job_id
		and trainer_id = p_trainer_id
	for update;

	if not found then
		raise exception 'import job not found for trainer';
	end if;

	if p_client_id is null then
		raise exception 'client_id is required';
	end if;

	if v_job.client_id is distinct from p_client_id then
		raise exception 'job/client mismatch';
	end if;

	if v_job.status not in ('ready', 'committing', 'committed') then
		raise exception 'job is not ready to commit';
	end if;

	update public.import_jobs
	set
		status = 'committing',
		progress_stage = 'committing',
		progress_percent = 95
	where id = v_job.id;

	select *
	into v_routine_row
	from public.routines
	where client_id = p_client_id
	for update;

	if not found then
		insert into public.routines (
			client_id,
			plan,
			last_saved_at,
			version
		)
		values (
			p_client_id,
			'{}'::jsonb,
			now(),
			1
		)
		on conflict (client_id) do update
		set client_id = excluded.client_id
		returning * into v_routine_row;
	end if;

	if v_routine_row.version is distinct from p_routine_version_expected then
		raise exception 'optimistic_lock_conflict'
			using detail = format(
				'expected_version=%s,current_version=%s',
				p_routine_version_expected,
				v_routine_row.version
			);
	end if;

	if p_next_plan is null then
		raise exception 'next plan is required';
	end if;

	if p_policy = 'overwrite_all' then
		v_target_plan := p_next_plan;
	elsif p_policy = 'overwrite_days' then
		if p_overwrite_days is null or array_length(p_overwrite_days, 1) is null then
			raise exception 'overwrite_days is required for overwrite_days policy';
		end if;
		v_target_plan := coalesce(v_routine_row.plan, '{}'::jsonb);
		foreach v_day in array p_overwrite_days loop
			if not (v_day = any(v_valid_days)) then
				raise exception 'invalid overwrite day key: %', v_day;
			end if;
			if not (p_next_plan ? v_day) then
				raise exception 'selected overwrite day missing in imported plan: %', v_day;
			end if;
			v_target_plan := jsonb_set(v_target_plan, array[v_day], p_next_plan -> v_day, true);
		end loop;
	else
		raise exception 'unsupported commit policy: %', p_policy;
	end if;

	insert into public.routine_backups (
		client_id,
		plan,
		routine_version,
		reason,
		created_by
	)
	values (
		p_client_id,
		coalesce(v_routine_row.plan, '{}'::jsonb),
		v_routine_row.version,
		format('import_commit:%s', p_job_id),
		p_trainer_id
	)
	returning id into v_backup_id;

	update public.routines
	set
		plan = v_target_plan,
		last_saved_at = now()
	where client_id = p_client_id
	returning version into v_routine_version_after;

	insert into public.import_commits (
		job_id,
		trainer_id,
		client_id,
		policy,
		overwrite_days,
		routine_version_before,
		routine_version_after,
		backup_id,
		commit_idempotency_key
	)
	values (
		p_job_id,
		p_trainer_id,
		p_client_id,
		p_policy,
		p_overwrite_days,
		v_routine_row.version,
		v_routine_version_after,
		v_backup_id,
		p_commit_idempotency_key
	)
	returning id into v_commit_id;

	update public.import_jobs
	set
		status = 'committed',
		progress_stage = 'committed',
		progress_percent = 100,
		lease_owner = null,
		lease_expires_at = null,
		error_code = null,
		error_message = null
	where id = p_job_id;

	insert into public.import_audit (
		job_id,
		trainer_id,
		client_id,
		event,
		payload
	)
	values (
		p_job_id,
		p_trainer_id,
		p_client_id,
		'committed',
		jsonb_build_object(
			'policy', p_policy::text,
			'overwrite_days', p_overwrite_days,
			'routine_version_before', v_routine_row.version,
			'routine_version_after', v_routine_version_after,
			'backup_id', v_backup_id
		)
	);

	return query
	select v_commit_id, v_routine_version_after, v_backup_id;
exception
	when unique_violation then
		select *
		into v_existing_commit
		from public.import_commits
		where commit_idempotency_key = p_commit_idempotency_key;
		if found then
			return query
			select v_existing_commit.id, v_existing_commit.routine_version_after, v_existing_commit.backup_id;
			return;
		end if;
		raise;
end;
$$;

create or replace function public.rollback_import_commit(
	p_job_id uuid,
	p_trainer_id uuid,
	p_client_id uuid,
	p_backup_id uuid default null
)
returns table (
	backup_id uuid,
	routine_version_after bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
	v_job public.import_jobs%rowtype;
	v_backup public.routine_backups%rowtype;
	v_version_after bigint;
begin
	select *
	into v_job
	from public.import_jobs
	where id = p_job_id
		and trainer_id = p_trainer_id
	for update;

	if not found then
		raise exception 'import job not found for trainer';
	end if;

	if v_job.client_id is distinct from p_client_id then
		raise exception 'job/client mismatch';
	end if;

	if p_backup_id is not null then
		select *
		into v_backup
		from public.routine_backups
		where id = p_backup_id
			and client_id = p_client_id
		for update;
	else
		select *
		into v_backup
		from public.routine_backups
		where client_id = p_client_id
		order by created_at desc
		limit 1
		for update;
	end if;

	if not found then
		raise exception 'backup not found';
	end if;

	update public.routines
	set
		plan = v_backup.plan,
		last_saved_at = now()
	where client_id = p_client_id
	returning version into v_version_after;

	update public.import_jobs
	set
		status = 'rolled_back',
		progress_stage = 'rolled_back',
		progress_percent = 100,
		lease_owner = null,
		lease_expires_at = null
	where id = p_job_id;

	insert into public.import_audit (
		job_id,
		trainer_id,
		client_id,
		event,
		payload
	)
	values (
		p_job_id,
		p_trainer_id,
		p_client_id,
		'rolled_back',
		jsonb_build_object(
			'backup_id', v_backup.id,
			'routine_version_after', v_version_after
		)
	);

	return query
	select v_backup.id, v_version_after;
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
	v_jobs_deleted integer := 0;
	v_backups_deleted integer := 0;
begin
	delete from public.import_job_artifacts
	where expires_at is not null
		and expires_at < now();
	get diagnostics v_artifacts_deleted = row_count;

	update public.import_jobs
	set status = 'expired'
	where status in ('queued', 'ready', 'failed')
		and expires_at is not null
		and expires_at < now();
	get diagnostics v_jobs_expired = row_count;

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

revoke all on table public.import_jobs from anon, authenticated;
revoke all on table public.import_job_artifacts from anon, authenticated;
revoke all on table public.import_drafts from anon, authenticated;
revoke all on table public.routine_backups from anon, authenticated;
revoke all on table public.import_commits from anon, authenticated;
revoke all on table public.import_audit from anon, authenticated;
revoke all on table public.import_tenant_limits from anon, authenticated;

revoke execute on function public.claim_import_jobs(text, integer, integer)
from public, anon, authenticated;
revoke execute on function public.apply_import_commit(
	uuid,
	uuid,
	uuid,
	public.import_commit_policy,
	text[],
	bigint,
	text,
	jsonb
)
from public, anon, authenticated;
revoke execute on function public.rollback_import_commit(uuid, uuid, uuid, uuid)
from public, anon, authenticated;
revoke execute on function public.purge_import_data()
from public, anon, authenticated;

grant execute on function public.claim_import_jobs(text, integer, integer) to service_role;
grant execute on function public.apply_import_commit(
	uuid,
	uuid,
	uuid,
	public.import_commit_policy,
	text[],
	bigint,
	text,
	jsonb
) to service_role;
grant execute on function public.rollback_import_commit(uuid, uuid, uuid, uuid) to service_role;
grant execute on function public.purge_import_data() to service_role;
