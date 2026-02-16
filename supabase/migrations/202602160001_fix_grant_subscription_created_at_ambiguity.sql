-- Fix ambiguous created_at reference in grant_trainer_subscription.
-- Without this patch, inserts can fail with:
--   column reference "created_at" is ambiguous

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

revoke execute on function public.grant_trainer_subscription(uuid, integer, uuid, text, text)
from public, anon, authenticated;

grant execute on function public.grant_trainer_subscription(uuid, integer, uuid, text, text)
to service_role;
