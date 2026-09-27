-- Parents manage their family's members ("Familie verwalten").
--
-- Until now members could only read family_members. Parents may now add,
-- edit and remove members of their own family. `user_id` (the login link)
-- stays out of reach of the API, so nobody can pull another account into
-- their family.

/** True when the signed-in user is a parent in the given family. */
create function private.is_family_parent(fid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.family_members
    where family_id = fid and user_id = auth.uid() and role = 'parent'
  );
$$;

revoke execute on function private.is_family_parent(uuid) from public, anon;
grant execute on function private.is_family_parent(uuid) to authenticated;

-- Column-level privileges: user_id / id / created_at can't be written.
revoke insert, update on public.family_members from anon, authenticated;
grant insert (family_id, name, emoji, color, role, sort_order)
  on public.family_members to authenticated;
grant update (name, emoji, color, role, sort_order)
  on public.family_members to authenticated;

create policy "Parents can add members to their family"
  on public.family_members for insert
  to authenticated
  with check (private.is_family_parent(family_id));

create policy "Parents can update their family's members"
  on public.family_members for update
  to authenticated
  using (private.is_family_parent(family_id))
  with check (private.is_family_parent(family_id));

-- Parents can't remove themselves, so a family never locks itself out.
create policy "Parents can remove other members of their family"
  on public.family_members for delete
  to authenticated
  using (
    private.is_family_parent(family_id)
    and user_id is distinct from (select auth.uid())
  );
