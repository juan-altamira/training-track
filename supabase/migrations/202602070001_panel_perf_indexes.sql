-- Performance indexes for /clientes <-> /clientes/[id]
-- Includes duplicate pre-checks before unique indexes.

do $$
begin
	if exists (
		select client_id
		from public.progress
		group by client_id
		having count(*) > 1
	) then
		raise exception 'Duplicate rows detected in progress(client_id). Resolve duplicates before applying unique index.';
	end if;

	if exists (
		select client_id
		from public.routines
		group by client_id
		having count(*) > 1
	) then
		raise exception 'Duplicate rows detected in routines(client_id). Resolve duplicates before applying unique index.';
	end if;
end $$;

create index if not exists idx_clients_trainer_created_at
	on public.clients (trainer_id, created_at);

create index if not exists idx_clients_trainer_name
	on public.clients (trainer_id, name);

create unique index if not exists idx_progress_client_id_unique
	on public.progress (client_id);

create unique index if not exists idx_routines_client_id_unique
	on public.routines (client_id);

create index if not exists idx_routines_last_saved_at
	on public.routines (last_saved_at);

create index if not exists idx_trainer_access_email_lower
	on public.trainer_access (lower(email));
