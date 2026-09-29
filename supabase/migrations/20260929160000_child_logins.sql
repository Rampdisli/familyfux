-- Kid logins: a kid can get their own account (design/belohnungen-profil.md, 6.5).
--
-- The kid signs up on the login page as usual; a parent then enters that
-- account's email at the kid in "Familie verwalten" (link_member_account).
-- family_members.user_id stays out of reach of the API, so accounts are only
-- linked through these functions: by a parent of the family, and only
-- accounts that don't belong to any family yet.
--
-- The role stays family_members.role. Parents keep acting for everybody;
-- kid logins join, tick off and leave pool entries (task_claims) and tick off
-- repeatable tasks (task_completions) only for themselves.

-- ---------------------------------------------------------------------------
-- Linking accounts
-- ---------------------------------------------------------------------------

/** Links the account with this email to a member of the caller's family. Parents only. */
create function public.link_member_account(p_member_id uuid, p_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m       public.family_members;
  account uuid;
begin
  select * into m from public.family_members where id = p_member_id for update;

  if m.id is null or not private.is_family_parent(m.family_id) then
    raise exception 'Nur Eltern können Konten verknüpfen.';
  end if;

  if m.user_id is not null then
    raise exception '% ist schon mit einem Konto verknüpft.', m.name;
  end if;

  select id into account from auth.users where lower(email) = lower(trim(p_email));

  if account is null then
    raise exception 'Es gibt kein Konto mit dieser E-Mail. Zuerst auf der Anmeldeseite registrieren.';
  end if;

  if exists (select 1 from public.family_members where user_id = account) then
    raise exception 'Dieses Konto gehört schon zu einer Familie.';
  end if;

  update public.family_members set user_id = account where id = m.id;
end;
$$;

/** Removes a member's login link again. Parents only, never their own. */
create function public.unlink_member_account(p_member_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.family_members
  set user_id = null
  where id = p_member_id
    and user_id is distinct from (select auth.uid())
    and private.is_family_parent(family_id);
  return found;
end;
$$;

/** Which account (email) each linked member of the caller's families uses. Parents only. */
create function public.family_member_accounts()
returns table (member_id uuid, email text)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, u.email::text
  from public.family_members m
  join auth.users u on u.id = m.user_id
  where private.is_family_parent(m.family_id);
$$;

revoke execute on function public.link_member_account(uuid, text) from public, anon;
revoke execute on function public.unlink_member_account(uuid) from public, anon;
revoke execute on function public.family_member_accounts() from public, anon;
grant execute on function public.link_member_account(uuid, text) to authenticated;
grant execute on function public.unlink_member_account(uuid) to authenticated;
grant execute on function public.family_member_accounts() to authenticated;

-- ---------------------------------------------------------------------------
-- Acting for a member
-- ---------------------------------------------------------------------------

/** Parents act for everybody in their family, everyone else only for themselves. */
create function private.can_act_for(fid uuid, mid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_family_parent(fid)
      or exists (
        select 1 from public.family_members
        where id = mid and family_id = fid and user_id = auth.uid()
      );
$$;

revoke execute on function private.can_act_for(uuid, uuid) from public, anon;
grant execute on function private.can_act_for(uuid, uuid) to authenticated;

-- task_claims: join, tick off, step out
drop policy "Members can join their family's tasks" on public.task_claims;
drop policy "Members can tick off their family's claims" on public.task_claims;
drop policy "Members can step out of unfinished claims" on public.task_claims;

-- The before-insert trigger fills family_id before this check runs.
create policy "Members can join their family's tasks"
  on public.task_claims for insert
  to authenticated
  with check (private.can_act_for(family_id, member_id));

-- A removed part can't be ticked off or on again.
create policy "Members can tick off their family's claims"
  on public.task_claims for update
  to authenticated
  using (private.can_act_for(family_id, member_id) and removed_at is null)
  with check (private.can_act_for(family_id, member_id));

-- Finished parts stay (they carry stars); tick them off first to step out.
create policy "Members can step out of unfinished claims"
  on public.task_claims for delete
  to authenticated
  using (private.can_act_for(family_id, member_id) and not is_done);

-- task_completions: tick off repeatable tasks, undo today's
drop policy "Members can tick off their family's repeatable tasks" on public.task_completions;
drop policy "Members can undo today's completions" on public.task_completions;

-- The before-insert trigger fills family_id before this check runs.
create policy "Members can tick off their family's repeatable tasks"
  on public.task_completions for insert
  to authenticated
  with check (private.can_act_for(family_id, member_id));

-- "Rückgängig": only today's completions (family time zone); earlier days are history.
create policy "Members can undo today's completions"
  on public.task_completions for delete
  to authenticated
  using (
    private.can_act_for(family_id, member_id)
    and exists (
      select 1 from public.families f
      where f.id = task_completions.family_id
        and (task_completions.completed_at at time zone f.timezone)::date = (now() at time zone f.timezone)::date
    )
  );
