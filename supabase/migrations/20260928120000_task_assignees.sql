-- Optional assignment: a parent can name who does a task when creating it.
-- Assigned members become participants (task_claims) of every occurrence of
-- the task; everybody else can still join from the pool. Without assignees the
-- task stays up for grabs as before.

create table public.task_assignees (
  task_id   uuid not null references public.tasks (id) on delete cascade,
  member_id uuid not null references public.family_members (id) on delete cascade,
  family_id uuid not null references public.families (id) on delete cascade,
  primary key (task_id, member_id)
);

create index task_assignees_member_id_idx on public.task_assignees (member_id);

/** Fills family_id from the task and checks the member belongs to that family. */
create function private.task_assignees_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select family_id into new.family_id from public.tasks where id = new.task_id;

  if not exists (
    select 1 from public.family_members where id = new.member_id and family_id = new.family_id
  ) then
    raise exception 'Member % is not part of this family', new.member_id;
  end if;

  return new;
end;
$$;

create trigger task_assignees_before_insert
  before insert on public.task_assignees
  for each row execute function private.task_assignees_before_insert();

/**
 * Keeps the open occurrences in line with the assignment: a new assignee joins
 * them, a removed one leaves them again (unless their part is already done).
 */
create function private.task_assignees_after_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.task_claims (occurrence_id, member_id)
    select o.id, new.member_id
    from public.task_occurrences o
    where o.task_id = new.task_id and not o.is_done
    on conflict (occurrence_id, member_id) do nothing;
  else
    delete from public.task_claims c
    using public.task_occurrences o
    where o.id = c.occurrence_id
      and o.task_id = old.task_id
      and not o.is_done
      and c.member_id = old.member_id
      and not c.is_done;
  end if;

  return null;
end;
$$;

create trigger task_assignees_after_write
  after insert or delete on public.task_assignees
  for each row execute function private.task_assignees_after_write();

/** Adds the task's latest due occurrence (up to today, family time) unless it exists — with its assignees. */
create or replace function private.ensure_occurrence(t public.tasks)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  tz     text;
  today  date;
  due    date;
  occ_id uuid;
begin
  if t.archived_at is not null then
    return;
  end if;

  select timezone into tz from public.families where id = t.family_id;
  today := (now() at time zone tz)::date;

  if t.schedule = 'after_completion' then
    -- Only once the previous one is done: repeat_every days after it was.
    if exists (select 1 from public.task_occurrences where task_id = t.id and not is_done) then
      return;
    end if;

    select max((done_at at time zone tz)::date) + t.repeat_every into due
    from public.task_occurrences
    where task_id = t.id and is_done;

    due := coalesce(due, t.start_date);
    if due > today then
      return;
    end if;
  else
    -- Latest matching day; 400 days back covers yearly schedules.
    select max(g.d::date) into due
    from generate_series(greatest(t.start_date, today - 400), today, interval '1 day') as g(d)
    where private.task_due_on(t, g.d::date);

    if due is null then
      return;
    end if;
  end if;

  insert into public.task_occurrences (task_id, family_id, due_date, reward, reward_mode)
  values (t.id, t.family_id, due, t.reward, t.reward_mode)
  on conflict (task_id, due_date) do nothing
  returning id into occ_id;

  -- A new occurrence starts with the task's assignees as participants.
  if occ_id is not null then
    insert into public.task_claims (occurrence_id, member_id)
    select occ_id, a.member_id from public.task_assignees a where a.task_id = t.id;
  end if;
end;
$$;

revoke execute on function private.task_assignees_before_insert() from public, anon, authenticated;
revoke execute on function private.task_assignees_after_write() from public, anon, authenticated;

alter table public.task_assignees enable row level security;

revoke all on public.task_assignees from anon, authenticated;
grant select, delete on public.task_assignees to authenticated;
grant insert (task_id, member_id) on public.task_assignees to authenticated;

create policy "Members can see who a task is assigned to"
  on public.task_assignees for select
  to authenticated
  using (private.is_family_member(family_id));

-- Assigning is part of creating / editing tasks: parents only.
-- The before-insert trigger fills family_id before this check runs.
create policy "Parents can assign their family's tasks"
  on public.task_assignees for insert
  to authenticated
  with check (private.is_family_parent(family_id));

create policy "Parents can unassign their family's tasks"
  on public.task_assignees for delete
  to authenticated
  using (private.is_family_parent(family_id));
