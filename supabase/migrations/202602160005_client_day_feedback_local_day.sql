-- Add explicit local-day and submitted timestamp metadata to day feedback.
-- Keeps existing unique behavior (one entry per client + day + progress cycle).

alter table public.client_day_feedback
	add column if not exists day_local date;

alter table public.client_day_feedback
	add column if not exists submitted_at timestamptz;

update public.client_day_feedback
set
	submitted_at = coalesce(submitted_at, created_at),
	day_local = coalesce(
		day_local,
		(coalesce(submitted_at, created_at) at time zone 'America/Argentina/Buenos_Aires')::date
	);

alter table public.client_day_feedback
	alter column submitted_at set not null;

alter table public.client_day_feedback
	alter column submitted_at set default now();

alter table public.client_day_feedback
	alter column day_local set not null;
