-- Repeatable tasks ("Immer wieder"): chores that come up several times a day,
-- e.g. feeding the cat. They can be ticked off any number of times; every
-- time, one family member earns the task's stars.
--
--   tasks.is_repeatable   the task never enters the pool as an occurrence;
--                         it's always there, in its own section
--   task_completions      one row per "done": who, when, stars at that time
--
-- The daily counter ("3× heute") is the number of today's completions in the
-- family's time zone (view task_completions_today); nothing is reset, the
-- rows simply stop counting as "today" after midnight. Their stars go into
-- claim_rewards like every finished part of a pool entry, so the week stars,
-- the progress pages and the task history include them.

-- ---------------------------------------------------------------------------
-- Tasks
-- ---------------------------------------------------------------------------

alter table public.tasks
  add column is_repeatable boolean not null default false;

grant update (is_repeatable) on public.tasks to authenticated;

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
  -- Repeatable tasks have no occurrences: they're ticked off via task_completions.
  if t.archived_at is not null or t.is_repeatable then
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

/**
 * Edited task → open occurrences follow the new schedule / reward / reward mode.
 * Made repeatable → its open pool entry goes away; no longer repeatable → it
 * gets its current occurrence (ensure_occurrence).
 */
create or replace function private.tasks_after_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.is_repeatable, new.schedule, new.start_date, new.repeat_every, new.weekdays, new.month_day, new.month)
     is distinct from
     (old.is_repeatable, old.schedule, old.start_date, old.repeat_every, old.weekdays, old.month_day, old.month) then
    delete from public.task_occurrences where task_id = new.id and not is_done;
    perform private.ensure_occurrence(new);
  elsif old.archived_at is not null and new.archived_at is null then
    perform private.ensure_occurrence(new);
  end if;

  if (new.reward, new.reward_mode) is distinct from (old.reward, old.reward_mode) then
    update public.task_occurrences set reward = new.reward, reward_mode = new.reward_mode
    where task_id = new.id and not is_done;
  end if;

  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Completions
-- ---------------------------------------------------------------------------

create table public.task_completions (
  id           uuid primary key default gen_random_uuid(),
  task_id      uuid not null references public.tasks (id) on delete cascade,
  family_id    uuid not null references public.families (id) on delete cascade,
  -- set null: removing a member keeps the task's history
  member_id    uuid references public.family_members (id) on delete set null,
  -- Stars at the time of the completion, so editing the task later doesn't
  -- rewrite anybody's history.
  reward       int not null check (reward > 0),
  completed_at timestamptz not null default now()
);

create index task_completions_task_id_idx on public.task_completions (task_id, completed_at);
create index task_completions_member_id_idx on public.task_completions (member_id, completed_at);
create index task_completions_family_id_idx on public.task_completions (family_id);

/**
 * Fills family_id and reward from the task, stamps completed_at and checks
 * the task is an active repeatable one and the member belongs to its family.
 */
create function private.task_completions_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tasks;
begin
  select * into t from public.tasks where id = new.task_id;

  if t.id is null or not t.is_repeatable or t.archived_at is not null then
    raise exception 'Task % is not an active repeatable task', new.task_id;
  end if;

  if not exists (
    select 1 from public.family_members where id = new.member_id and family_id = t.family_id
  ) then
    raise exception 'Member % is not part of this family', new.member_id;
  end if;

  new.family_id := t.family_id;
  new.reward := t.reward;
  new.completed_at := now();

  return new;
end;
$$;

revoke execute on function private.task_completions_before_insert() from public, anon, authenticated;

create trigger task_completions_before_insert
  before insert on public.task_completions
  for each row execute function private.task_completions_before_insert();

alter table public.task_completions enable row level security;

revoke all on public.task_completions from anon, authenticated;
grant select, delete on public.task_completions to authenticated;
grant insert (task_id, member_id) on public.task_completions to authenticated;

create policy "Members can view their family's completions"
  on public.task_completions for select
  to authenticated
  using (private.is_family_member(family_id));

-- The before-insert trigger fills family_id before this check runs.
create policy "Members can tick off their family's repeatable tasks"
  on public.task_completions for insert
  to authenticated
  with check (private.is_family_member(family_id));

-- "Rückgängig": only today's completions (family time zone) can be taken back;
-- earlier days are history.
create policy "Members can undo today's completions"
  on public.task_completions for delete
  to authenticated
  using (
    private.is_family_member(family_id)
    and exists (
      select 1 from public.families f
      where f.id = task_completions.family_id
        and (task_completions.completed_at at time zone f.timezone)::date = (now() at time zone f.timezone)::date
    )
  );

-- ---------------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------------

/** Today's completions (family time zone): the "3× heute" counter. */
create view public.task_completions_today
with (security_invoker = true)
as
select c.id, c.task_id, c.family_id, c.member_id, c.reward, c.completed_at
from public.task_completions c
join public.families f on f.id = c.family_id
where (c.completed_at at time zone f.timezone)::date = (now() at time zone f.timezone)::date;

/**
 * Stars per participant: the full reward, or an equal share of it — plus one
 * row per completion of a repeatable task (occurrence_id is null there).
 */
create or replace view public.claim_rewards
with (security_invoker = true)
as
select
  c.id,
  c.occurrence_id,
  c.family_id,
  c.member_id,
  c.claimed_at,
  c.is_done,
  c.done_at,
  o.task_id,
  o.due_date,
  case
    when o.reward_mode = 'split' then round(o.reward::numeric / count(*) over (partition by c.occurrence_id), 2)
    else o.reward::numeric
  end as stars
from public.task_claims c
join public.task_occurrences o on o.id = c.occurrence_id
union all
select
  tc.id,
  null::uuid,
  tc.family_id,
  tc.member_id,
  tc.completed_at,
  true,
  tc.completed_at,
  tc.task_id,
  (tc.completed_at at time zone f.timezone)::date,
  tc.reward::numeric
from public.task_completions tc
join public.families f on f.id = tc.family_id;

grant select on public.task_completions_today to authenticated;
