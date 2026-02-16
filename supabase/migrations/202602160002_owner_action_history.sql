-- Owner admin actions audit trail (persistent, append-only from app side).
-- Keeps a durable record of high-impact operations done in /clientes owner panel.

create extension if not exists pgcrypto;

create table if not exists public.owner_action_history (
	id uuid primary key default gen_random_uuid(),
	admin_id uuid,
	admin_email text not null,
	action_type text not null check (
		action_type in ('add_trainer', 'grant_subscription', 'toggle_trainer', 'force_sign_out')
	),
	target_email text,
	target_trainer_id uuid,
	details jsonb not null default '{}'::jsonb,
	created_at timestamptz not null default now()
);

create index if not exists idx_owner_action_history_admin_created_at
	on public.owner_action_history (admin_email, created_at desc);

create index if not exists idx_owner_action_history_created_at
	on public.owner_action_history (created_at desc);

revoke all on table public.owner_action_history from anon, authenticated;
