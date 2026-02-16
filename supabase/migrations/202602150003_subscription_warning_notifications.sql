-- Deduplicated warning signal when a subscription enters the threshold window.

create table if not exists public.subscription_warning_log (
	trainer_id uuid primary key references public.trainers(id) on delete cascade,
	warned_active_until timestamptz not null,
	warned_at timestamptz not null default now()
);

create index if not exists idx_subscription_warning_log_warned_at
	on public.subscription_warning_log (warned_at desc);

create or replace function public.get_and_mark_subscription_warning(
	p_email text,
	p_threshold_days integer default 5
)
returns table (
	should_show boolean,
	reason text,
	active_until timestamptz,
	days_remaining integer,
	warned_at timestamptz,
	now_utc timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
	v_email text := lower(trim(p_email));
	v_threshold_days integer := coalesce(p_threshold_days, 5);
	v_now timestamptz := now();
	v_threshold interval;
	v_trainer_id uuid;
	v_active_until timestamptz;
	v_existing_until timestamptz;
	v_existing_warned_at timestamptz;
	v_days_remaining integer;
begin
	if v_email is null or v_email = '' then
		return query
		select false, 'missing_email', null::timestamptz, null::integer, null::timestamptz, v_now;
		return;
	end if;

	if v_threshold_days < 1 or v_threshold_days > 30 then
		raise exception 'threshold_days must be between 1 and 30';
	end if;

	select t.id, t.active_until
	into v_trainer_id, v_active_until
	from public.trainers as t
	where lower(t.email) = v_email
	limit 1;

	if not found then
		return query
		select false, 'not_found', null::timestamptz, null::integer, null::timestamptz, v_now;
		return;
	end if;

	v_days_remaining := greatest(
		0,
		ceil(extract(epoch from (v_active_until - v_now)) / 86400.0)::integer
	);

	if v_active_until <= v_now then
		return query
		select false, 'expired', v_active_until, 0, null::timestamptz, v_now;
		return;
	end if;

	v_threshold := make_interval(days => v_threshold_days);
	if v_active_until > (v_now + v_threshold) then
		return query
		select false, 'outside_window', v_active_until, v_days_remaining, null::timestamptz, v_now;
		return;
	end if;

	select l.warned_active_until, l.warned_at
	into v_existing_until, v_existing_warned_at
	from public.subscription_warning_log as l
	where l.trainer_id = v_trainer_id;

	if v_existing_until is null or v_existing_until is distinct from v_active_until then
		insert into public.subscription_warning_log (trainer_id, warned_active_until, warned_at)
		values (v_trainer_id, v_active_until, v_now)
		on conflict (trainer_id) do update
		set
			warned_active_until = excluded.warned_active_until,
			warned_at = excluded.warned_at;

		return query
		select true, 'within_window', v_active_until, v_days_remaining, v_now, v_now;
		return;
	end if;

	return query
	select false, 'already_warned', v_active_until, v_days_remaining, v_existing_warned_at, v_now;
end;
$$;

revoke execute on function public.get_and_mark_subscription_warning(text, integer)
from public, anon, authenticated;

grant execute on function public.get_and_mark_subscription_warning(text, integer)
to service_role;
