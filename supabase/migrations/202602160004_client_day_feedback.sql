-- Student day-feelings survey (voluntary, per day, per progress cycle)

create extension if not exists pgcrypto;

create table if not exists public.client_day_feedback (
	id uuid primary key default gen_random_uuid(),
	client_id uuid not null references public.clients(id) on delete cascade,
	day_key text not null check (
		day_key in ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')
	),
	cycle_key text not null,
	cycle_started_at timestamptz,
	mood text check (mood in ('excellent', 'good', 'normal', 'tired', 'very_fatigued')),
	difficulty integer check (difficulty between 1 and 10),
	pain text check (pain in ('none', 'mild', 'moderate', 'severe')),
	comment text check (char_length(comment) <= 300),
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create unique index if not exists idx_client_day_feedback_client_day_cycle_unique
	on public.client_day_feedback (client_id, day_key, cycle_key);

create index if not exists idx_client_day_feedback_client_cycle
	on public.client_day_feedback (client_id, cycle_key);

create or replace function public.set_client_day_feedback_updated_at()
returns trigger
language plpgsql
as $$
begin
	new.updated_at = now();
	return new;
end;
$$;

drop trigger if exists trg_client_day_feedback_updated_at on public.client_day_feedback;
create trigger trg_client_day_feedback_updated_at
	before update on public.client_day_feedback
	for each row
	execute function public.set_client_day_feedback_updated_at();

revoke all on table public.client_day_feedback from anon, authenticated;
