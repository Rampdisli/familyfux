-- Keep the SECURITY DEFINER helpers out of the public REST API (/rest/v1/rpc/…).

-- RLS policies call is_family_member() as the signed-in user, so it stays
-- executable for `authenticated`, just in a schema PostgREST doesn't expose.
-- Policies reference the function by OID and keep working after the move.
create schema if not exists private;
grant usage on schema private to authenticated;

alter function public.is_family_member(uuid) set schema private;
revoke execute on function private.is_family_member(uuid) from public, anon;
grant execute on function private.is_family_member(uuid) to authenticated;

-- Trigger functions never need to be called directly.
revoke execute on function public.tasks_before_write() from public, anon, authenticated;

-- Evaluate auth.uid() once per statement instead of once per row.
alter policy "Members can add tasks to their family"
  on public.tasks
  with check ((select auth.uid()) = user_id and private.is_family_member(family_id));
