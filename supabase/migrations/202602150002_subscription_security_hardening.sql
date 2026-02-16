-- Minimal hardening for subscription ledger RPC/table access.
-- Restricts critical mutation paths to service_role only.

revoke execute on function public.grant_trainer_subscription(uuid, integer, uuid, text, text)
from public, anon, authenticated;

grant execute on function public.grant_trainer_subscription(uuid, integer, uuid, text, text)
to service_role;

revoke all on table public.subscription_grants from anon, authenticated;
revoke all on table public.trainer_access from anon, authenticated;
revoke all on table public.trainers from anon, authenticated;
