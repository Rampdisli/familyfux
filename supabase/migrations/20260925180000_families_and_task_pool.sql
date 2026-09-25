-- Families, family members and the task pool ("Fuxis Plan").
--
-- `tasks` is extended in place instead of being replaced, so the MCP server
-- (which inserts `title` + `user_id` and reads `is_done`) keeps working.
-- Access moves from "own rows" to "rows of my family".

-- ---------------------------------------------------------------------------
-- Families & members
-- ---------------------------------------------------------------------------

create table public.families (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  timezone   text not null default 'Europe/Zurich',
  created_at timestamptz not null default now()
);

create table public.family_members (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null references public.families (id) on delete cascade,
  -- null for members without their own login (e.g. kids)
  user_id    uuid references auth.users (id) on delete set null,
  name       text not null,
  emoji      text not null,
  color      text not null check (color in ('mint', 'lilac', 'sky', 'rose', 'peach', 'lemon')),
  role       text not null default 'child' check (role in ('parent', 'child')),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (family_id, user_id)
);

create index family_members_user_id_idx on public.family_members (user_id);

/** True when the signed-in user is a member of the given family. */
create function public.is_family_member(fid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.family_members
    where family_id = fid and user_id = auth.uid()
  );
$$;

alter table public.families enable row level security;
alter table public.family_members enable row level security;

create policy "Members can view their family"
  on public.families for select
  using (public.is_family_member(id));

create policy "Members can view their family's members"
  on public.family_members for select
  using (public.is_family_member(family_id));

-- ---------------------------------------------------------------------------
-- Tasks → task pool
-- ---------------------------------------------------------------------------

alter table public.tasks
  add column family_id  uuid references public.families (id) on delete cascade,
  add column emoji      text not null default '✅',
  add column color      text not null default 'peach'
    check (color in ('mint', 'lilac', 'sky', 'rose', 'peach', 'lemon')),
  add column reward     int not null default 1 check (reward > 0),
  add column claimed_by uuid references public.family_members (id) on delete set null,
  add column claimed_at timestamptz,
  add column done_at    timestamptz;

comment on column public.tasks.user_id is 'User who created the task.';

create index tasks_family_id_idx on public.tasks (family_id);
create index tasks_claimed_by_idx on public.tasks (claimed_by);

/**
 * Fills defaults the clients don't send:
 * - family_id from the creator's family (the MCP server only sends title + user_id)
 * - claimed_at / done_at timestamps, kept in sync with claimed_by / is_done
 */
create function public.tasks_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.family_id is null then
    select family_id into new.family_id
    from public.family_members
    where user_id = new.user_id
    order by created_at
    limit 1;

    if new.family_id is null then
      raise exception 'User % is not a member of any family', new.user_id;
    end if;
  end if;

  if new.claimed_by is distinct from (case when tg_op = 'UPDATE' then old.claimed_by end) then
    new.claimed_at := case when new.claimed_by is null then null else now() end;
  end if;

  if new.is_done and new.done_at is null then
    new.done_at := now();
  elsif not new.is_done then
    new.done_at := null;
  end if;

  return new;
end;
$$;

create trigger tasks_before_write
  before insert or update on public.tasks
  for each row execute function public.tasks_before_write();

drop policy "Users can view their own tasks" on public.tasks;
drop policy "Users can insert their own tasks" on public.tasks;
drop policy "Users can update their own tasks" on public.tasks;
drop policy "Users can delete their own tasks" on public.tasks;

create policy "Members can view their family's tasks"
  on public.tasks for select
  using (public.is_family_member(family_id));

-- The trigger fills family_id before this check runs.
create policy "Members can add tasks to their family"
  on public.tasks for insert
  with check (auth.uid() = user_id and public.is_family_member(family_id));

create policy "Members can update their family's tasks"
  on public.tasks for update
  using (public.is_family_member(family_id))
  with check (public.is_family_member(family_id));

create policy "Members can delete their family's tasks"
  on public.tasks for delete
  using (public.is_family_member(family_id));

-- ---------------------------------------------------------------------------
-- Stars this week (derived, never stored)
-- ---------------------------------------------------------------------------

create view public.member_week_stars
with (security_invoker = true)
as
select
  m.id        as member_id,
  m.family_id,
  coalesce(sum(t.reward), 0)::int as stars
from public.family_members m
join public.families f on f.id = m.family_id
left join public.tasks t
  on t.claimed_by = m.id
 and t.is_done
 and t.done_at >= (date_trunc('week', now() at time zone f.timezone) at time zone f.timezone)
group by m.id, m.family_id;

-- ---------------------------------------------------------------------------
-- Data migration: one family with Ramona, existing tasks move into it
-- ---------------------------------------------------------------------------

do $$
declare
  ramona_user uuid;
  fam uuid;
begin
  select id into ramona_user from auth.users where email = 'ramona.maurer5@gmail.com';

  if ramona_user is null then
    return; -- fresh / local database without that account
  end if;

  insert into public.families (name) values ('Familie') returning id into fam;

  insert into public.family_members (family_id, user_id, name, emoji, color, role)
  values (fam, ramona_user, 'Ramona', '🦊', 'rose', 'parent');

  update public.tasks set
    family_id = fam,
    emoji = case
      when title ilike '%fenster%'      then '🪟'
      when title ilike '%staubsaugen%'  then '🧹'
      when title ilike '%aufnehmen%'    then '🧽'
      when title ilike '%aufräumen%'    then '🧺'
      when title ilike '%foxy%'         then '🦊'
      else emoji
    end,
    color = case
      when title ilike '%fenster%'      then 'sky'
      when title ilike '%staubsaugen%'  then 'lilac'
      when title ilike '%aufnehmen%'    then 'mint'
      when title ilike '%aufräumen%'    then 'lemon'
      else color
    end,
    reward = case
      when title ilike '%fenster%'      then 3
      when title ilike '%aufräumen%'    then 3
      when title ilike '%staubsaugen%'  then 2
      when title ilike '%aufnehmen%'    then 2
      else reward
    end,
    done_at = case when is_done then created_at end;
end;
$$;

-- Every task belongs to a family from now on. Fails (and rolls back the whole
-- migration) if a task of another account was left without a family.
alter table public.tasks alter column family_id set not null;
