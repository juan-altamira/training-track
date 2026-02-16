-- Adds 1-hour trial support for subscription grants while keeping
-- 30-day month semantics and idempotency guarantees.

alter table public.subscription_grants
	add column if not exists duration_seconds integer;

do $$
begin
	if exists (
		select 1
		from pg_trigger
		where tgrelid = 'public.subscription_grants'::regclass
			and tgname = 'trg_subscription_grants_no_update'
			and not tgisinternal
	) then
		execute 'alter table public.subscription_grants disable trigger trg_subscription_grants_no_update';
	end if;

	begin
		update public.subscription_grants
		set duration_seconds = days * 86400
		where duration_seconds is null;
	exception
		when others then
			if exists (
				select 1
				from pg_trigger
				where tgrelid = 'public.subscription_grants'::regclass
					and tgname = 'trg_subscription_grants_no_update'
					and not tgisinternal
			) then
				execute 'alter table public.subscription_grants enable trigger trg_subscription_grants_no_update';
			end if;
			raise;
	end;

	if exists (
		select 1
		from pg_trigger
		where tgrelid = 'public.subscription_grants'::regclass
			and tgname = 'trg_subscription_grants_no_update'
			and not tgisinternal
	) then
		execute 'alter table public.subscription_grants enable trigger trg_subscription_grants_no_update';
	end if;
end $$;

alter table public.subscription_grants
	alter column duration_seconds set not null;

alter table public.subscription_grants
	alter column duration_seconds set default 2592000;

alter table public.subscription_grants
	drop constraint if exists subscription_grants_days_check;

alter table public.subscription_grants
	drop constraint if exists subscription_grants_duration_seconds_check;

alter table public.subscription_grants
	add constraint subscription_grants_duration_seconds_check check (
		duration_seconds <> 0
		and abs(duration_seconds) <= 31104000
		and (
			(days = 0 and abs(duration_seconds) = 3600)
			or (days <> 0 and mod(days, 30) = 0 and duration_seconds = days * 86400)
		)
	);

create or replace function public.grant_trainer_subscription(
	p_trainer_id uuid,
	p_days integer,
	p_admin_id uuid,
	p_reason text,
	p_idempotency_key text
)
returns table (
	applied boolean,
	grant_id uuid,
	active_until_before timestamptz,
	active_until_after timestamptz,
	created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
	v_now timestamptz := now();
	v_before timestamptz;
	v_after timestamptz;
	v_grant_id uuid;
	v_grant_created_at timestamptz;
	v_existing public.subscription_grants%rowtype;
	v_reason text := nullif(btrim(p_reason), '');
	v_duration_seconds integer;
	v_days_for_ledger integer;
begin
	if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
		raise exception 'idempotency_key is required';
	end if;

	if p_days is null or p_days = 0 then
		raise exception 'duration must be non-zero';
	end if;

	-- Backward-compatible mode: if caller still sends days (30/60/...)
	-- convert to seconds internally.
	if abs(p_days) <= 360 and mod(p_days, 30) = 0 then
		v_duration_seconds := p_days * 86400;
		v_days_for_ledger := p_days;
	-- New mode: explicit 1-hour trial.
	elsif abs(p_days) = 3600 then
		v_duration_seconds := p_days;
		v_days_for_ledger := 0;
	-- New mode: explicit month durations in seconds (1..12 months).
	elsif mod(abs(p_days), 2592000) = 0 and abs(p_days) <= 31104000 then
		v_duration_seconds := p_days;
		v_days_for_ledger := p_days / 86400;
	else
		raise exception 'duration must be 1 hour or 1-12 months';
	end if;

	select t.active_until
	into v_before
	from public.trainers as t
	where t.id = p_trainer_id
	for update;

	if not found then
		raise exception 'trainer not found';
	end if;

	v_after := greatest(v_before, v_now) + make_interval(secs => v_duration_seconds);

	insert into public.subscription_grants as sg (
		trainer_id,
		days,
		duration_seconds,
		admin_id,
		idempotency_key,
		reason,
		active_until_before,
		active_until_after
	)
	values (
		p_trainer_id,
		v_days_for_ledger,
		v_duration_seconds,
		p_admin_id,
		p_idempotency_key,
		v_reason,
		v_before,
		v_after
	)
	on conflict (idempotency_key) do nothing
	returning sg.id, sg.created_at
	into v_grant_id, v_grant_created_at;

	if v_grant_id is not null then
		update public.trainers
		set
			active_until = v_after,
			status = case when v_after > v_now then 'active' else 'inactive' end
		where id = p_trainer_id;

		return query
		select true, v_grant_id, v_before, v_after, v_grant_created_at;
		return;
	end if;

	select *
	into v_existing
	from public.subscription_grants
	where idempotency_key = p_idempotency_key;

	if not found then
		raise exception 'idempotency key conflict without persisted row';
	end if;

	if v_existing.trainer_id is distinct from p_trainer_id
		or v_existing.duration_seconds is distinct from v_duration_seconds
		or v_existing.admin_id is distinct from p_admin_id
		or coalesce(v_existing.reason, '') <> coalesce(v_reason, '') then
		raise exception 'idempotency key reused with different payload';
	end if;

	return query
	select false, v_existing.id, v_existing.active_until_before, v_existing.active_until_after, v_existing.created_at;
end;
$$;

revoke execute on function public.grant_trainer_subscription(uuid, integer, uuid, text, text)
from public, anon, authenticated;

grant execute on function public.grant_trainer_subscription(uuid, integer, uuid, text, text)
to service_role;
