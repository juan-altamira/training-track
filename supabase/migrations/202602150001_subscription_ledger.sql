-- Subscription credits ledger + idempotent grants + DB-time access gate
-- This migration is backward-compatible with existing trainer_access logic.

create extension if not exists pgcrypto;

alter table public.trainers
	add column if not exists active_until timestamptz;

update public.trainers
set active_until = coalesce(active_until, now() + interval '30 days');

alter table public.trainers
	alter column active_until set not null;

alter table public.trainers
	alter column active_until set default (now() + interval '30 days');

create index if not exists idx_trainers_active_until
	on public.trainers (active_until);

create index if not exists idx_trainers_email_lower
	on public.trainers (lower(email));

create table if not exists public.subscription_grants (
	id uuid primary key default gen_random_uuid(),
	trainer_id uuid not null references public.trainers(id) on delete cascade,
	days integer not null check (
		days <> 0
		and days between -360 and 360
		and mod(days, 30) = 0
	),
	admin_id uuid,
	idempotency_key text not null unique,
	reason text,
	active_until_before timestamptz not null,
	active_until_after timestamptz not null,
	created_at timestamptz not null default now()
);

create index if not exists idx_subscription_grants_trainer_created_at
	on public.subscription_grants (trainer_id, created_at desc);

create or replace function public.prevent_subscription_grants_mutation()
returns trigger
language plpgsql
as $$
begin
	raise exception 'subscription_grants is append-only';
end;
$$;

drop trigger if exists trg_subscription_grants_no_update on public.subscription_grants;
create trigger trg_subscription_grants_no_update
	before update on public.subscription_grants
	for each row
	execute function public.prevent_subscription_grants_mutation();

drop trigger if exists trg_subscription_grants_no_delete on public.subscription_grants;
create trigger trg_subscription_grants_no_delete
	before delete on public.subscription_grants
	for each row
	execute function public.prevent_subscription_grants_mutation();

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
begin
	if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
		raise exception 'idempotency_key is required';
	end if;

	if p_days is null or p_days = 0 then
		raise exception 'days must be non-zero';
	end if;

	if mod(p_days, 30) <> 0 then
		raise exception 'days must be a multiple of 30';
	end if;

	if abs(p_days) > 360 then
		raise exception 'days per operation must be <= 360';
	end if;

	select t.active_until
	into v_before
	from public.trainers as t
	where t.id = p_trainer_id
	for update;

	if not found then
		raise exception 'trainer not found';
	end if;

	v_after := greatest(v_before, v_now) + make_interval(days => p_days);

	insert into public.subscription_grants as sg (
		trainer_id,
		days,
		admin_id,
		idempotency_key,
		reason,
		active_until_before,
		active_until_after
	)
	values (
		p_trainer_id,
		p_days,
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
		or v_existing.days is distinct from p_days
		or v_existing.admin_id is distinct from p_admin_id
		or coalesce(v_existing.reason, '') <> coalesce(v_reason, '') then
		raise exception 'idempotency key reused with different payload';
	end if;

	return query
	select false, v_existing.id, v_existing.active_until_before, v_existing.active_until_after, v_existing.created_at;
end;
$$;

create or replace function public.get_trainer_access_status(p_email text)
returns table (
	trainer_id uuid,
	email text,
	manual_active boolean,
	active_until timestamptz,
	subscription_active boolean,
	allowed boolean,
	now_utc timestamptz
)
language sql
security definer
set search_path = public
as $$
	with normalized as (
		select lower(trim(p_email)) as email
	),
	trainer as (
		select t.id, lower(t.email) as email, t.active_until
		from public.trainers as t
		join normalized as n
			on lower(t.email) = n.email
		limit 1
	),
	access_row as (
		select coalesce(a.active, false) as active
		from public.trainer_access as a
		join normalized as n
			on lower(a.email) = n.email
		limit 1
	)
	select
		t.id as trainer_id,
		t.email,
		coalesce((select ar.active from access_row as ar), false) as manual_active,
		t.active_until,
		(t.active_until > now()) as subscription_active,
		(coalesce((select ar.active from access_row as ar), false) and t.active_until > now()) as allowed,
		now() as now_utc
	from trainer as t;
$$;
