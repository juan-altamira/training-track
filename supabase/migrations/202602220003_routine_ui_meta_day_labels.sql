-- Adds routine UI metadata for day label mode while keeping day keys fixed.
-- Also extends import commit/rollback to include ui_meta in atomic writes/backups.

alter table public.routines
	add column if not exists ui_meta jsonb not null default '{}'::jsonb;

alter table public.routine_backups
	add column if not exists ui_meta jsonb not null default '{}'::jsonb;

update public.routines
set ui_meta = '{}'::jsonb
where ui_meta is null;

update public.routine_backups
set ui_meta = '{}'::jsonb
where ui_meta is null;

do $$
begin
	if not exists (
		select 1
		from pg_constraint
		where conname = 'routines_ui_meta_day_label_mode_chk'
	) then
		alter table public.routines
			add constraint routines_ui_meta_day_label_mode_chk
			check (
				jsonb_typeof(ui_meta) = 'object'
				and (
					not (ui_meta ? 'day_label_mode')
					or ui_meta->>'day_label_mode' in ('weekday', 'sequential', 'custom')
				)
				and (
					not (ui_meta ? 'hide_empty_days_in_sequential')
					or jsonb_typeof(ui_meta->'hide_empty_days_in_sequential') = 'boolean'
				)
			);
	end if;

	if not exists (
		select 1
		from pg_constraint
		where conname = 'routine_backups_ui_meta_day_label_mode_chk'
	) then
		alter table public.routine_backups
			add constraint routine_backups_ui_meta_day_label_mode_chk
			check (
				jsonb_typeof(ui_meta) = 'object'
				and (
					not (ui_meta ? 'day_label_mode')
					or ui_meta->>'day_label_mode' in ('weekday', 'sequential', 'custom')
				)
				and (
					not (ui_meta ? 'hide_empty_days_in_sequential')
					or jsonb_typeof(ui_meta->'hide_empty_days_in_sequential') = 'boolean'
				)
			);
	end if;
end
$$;

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

	if
		new.plan is distinct from old.plan
		or new.ui_meta is distinct from old.ui_meta
	then
		new.version := old.version + 1;
	else
		new.version := old.version;
	end if;

	return new;
end;
$$;

drop function if exists public.apply_import_commit(
	uuid,
	uuid,
	uuid,
	public.import_commit_policy,
	text[],
	bigint,
	text,
	jsonb
);

create or replace function public.apply_import_commit(
	p_job_id uuid,
	p_trainer_id uuid,
	p_client_id uuid,
	p_policy public.import_commit_policy,
	p_overwrite_days text[],
	p_routine_version_expected bigint,
	p_commit_idempotency_key text,
	p_next_plan jsonb,
	p_next_ui_meta jsonb default null
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
	v_existing_ui_meta jsonb := '{}'::jsonb;
	v_target_ui_meta jsonb := '{}'::jsonb;
	v_incoming_ui_meta jsonb := '{}'::jsonb;
	v_incoming_mode text;
	v_effective_mode text;
	v_hide_empty_days boolean;
	v_existing_label text;
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
			ui_meta,
			last_saved_at,
			version
		)
		values (
			p_client_id,
			'{}'::jsonb,
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

	if p_next_ui_meta is not null and jsonb_typeof(p_next_ui_meta) <> 'object' then
		raise exception 'invalid ui_meta payload';
	end if;

	v_existing_ui_meta := coalesce(v_routine_row.ui_meta, '{}'::jsonb);
	v_incoming_ui_meta := coalesce(p_next_ui_meta, '{}'::jsonb);
	v_target_ui_meta := v_existing_ui_meta;

	if v_incoming_ui_meta ? 'day_label_mode' then
		v_incoming_mode := v_incoming_ui_meta->>'day_label_mode';
		if v_incoming_mode not in ('weekday', 'sequential', 'custom') then
			raise exception 'invalid day_label_mode: %', v_incoming_mode;
		end if;
		v_target_ui_meta := v_incoming_ui_meta;
	end if;

	v_effective_mode := coalesce(v_target_ui_meta->>'day_label_mode', v_existing_ui_meta->>'day_label_mode', 'weekday');
	if v_effective_mode not in ('weekday', 'sequential', 'custom') then
		v_effective_mode := 'weekday';
	end if;

	v_hide_empty_days :=
		coalesce(
			case
				when v_target_ui_meta ? 'hide_empty_days_in_sequential'
					and jsonb_typeof(v_target_ui_meta->'hide_empty_days_in_sequential') = 'boolean'
				then (v_target_ui_meta->>'hide_empty_days_in_sequential')::boolean
				else null
			end,
			case
				when v_existing_ui_meta ? 'hide_empty_days_in_sequential'
					and jsonb_typeof(v_existing_ui_meta->'hide_empty_days_in_sequential') = 'boolean'
				then (v_existing_ui_meta->>'hide_empty_days_in_sequential')::boolean
				else null
			end,
			true
		);

	v_target_ui_meta := jsonb_build_object(
		'day_label_mode',
		v_effective_mode,
		'hide_empty_days_in_sequential',
		v_hide_empty_days
	);

	if v_effective_mode <> 'custom' then
		foreach v_day in array v_valid_days loop
			v_existing_label := nullif(btrim(coalesce(v_routine_row.plan -> v_day ->> 'label', '')), '');
			if v_existing_label is not null then
				v_target_plan := jsonb_set(
					v_target_plan,
					array[v_day, 'label'],
					to_jsonb(v_existing_label),
					true
				);
			end if;
		end loop;
	end if;

	insert into public.routine_backups (
		client_id,
		plan,
		ui_meta,
		routine_version,
		reason,
		created_by
	)
	values (
		p_client_id,
		coalesce(v_routine_row.plan, '{}'::jsonb),
		coalesce(v_routine_row.ui_meta, '{}'::jsonb),
		v_routine_row.version,
		format('import_commit:%s', p_job_id),
		p_trainer_id
	)
	returning id into v_backup_id;

	update public.routines
	set
		plan = v_target_plan,
		ui_meta = v_target_ui_meta,
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
			'backup_id', v_backup_id,
			'day_label_mode', v_effective_mode,
			'hide_empty_days_in_sequential', v_hide_empty_days
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
		ui_meta = coalesce(v_backup.ui_meta, '{}'::jsonb),
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
			'routine_version_after', v_version_after,
			'day_label_mode', coalesce(v_backup.ui_meta->>'day_label_mode', 'weekday')
		)
	);

	return query
	select v_backup.id, v_version_after;
end;
$$;

revoke execute on function public.apply_import_commit(
	uuid,
	uuid,
	uuid,
	public.import_commit_policy,
	text[],
	bigint,
	text,
	jsonb,
	jsonb
)
from public, anon, authenticated;

grant execute on function public.apply_import_commit(
	uuid,
	uuid,
	uuid,
	public.import_commit_policy,
	text[],
	bigint,
	text,
	jsonb,
	jsonb
) to service_role;
