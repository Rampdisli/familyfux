-- Tasks become definitions with a schedule; each appearance in the pool is a
-- row in task_occurrences, which also holds who claimed and finished it.
--
--   tasks             what: title, emoji, colour, reward, schedule
--   task_occurrences  when: due date, claimed_by, is_done/done_at, stars earned
--
-- Occurrences are created lazily: public.refresh_task_pool() (called by the
-- app and the MCP server before reading the pool) adds the latest due
-- occurrence of every task, and inserting a task creates its first one.
--
-- The pool (view task_pool) shows the latest occurrence of every active task
-- while it is open, and on the day it was finished.

-- ---------------------------------------------------------------------------
-- Safety net: the tasks table as it was before this migration
-- ---------------------------------------------------------------------------

create table private.tasks_backup_20260927 as table public.tasks;

-- ---------------------------------------------------------------------------
-- Schedule on tasks
-- ---------------------------------------------------------------------------

alter table public.tasks
  add column schedule     text not null default 'once' check (schedule in (
    'once',             -- one time, appears on start_date
    'daily',
    'weekly',           -- on weekdays[1]
    'weekdays',         -- on each of weekdays
    'every_x_days',     -- every repeat_every days from start_date
    'monthly',          -- on month_day
    'every_x_weeks',    -- every repeat_every weeks on weekdays[1]
    'every_x_months',   -- every repeat_every months on month_day
    'yearly',           -- on month_day of month
    'after_completion'  -- repeat_every days after the last completion
  )),
  add column start_date   date not null default current_date,
  add column repeat_every smallint check (repeat_every between 1 and 365),
  -- ISO weekdays: 1 = Monday … 7 = Sunday
  add column weekdays     smallint[] check (weekdays <@ '{1,2,3,4,5,6,7}'::smallint[]),
  -- 29–31 fall on the last day of shorter months
  add column month_day    smallint check (month_day between 1 and 31),
  add column month        smallint check (month between 1 and 12),
  -- Archived tasks leave the pool but keep their history.
  add column archived_at  timestamptz;

-- coalesce: a check that evaluates to NULL would pass.
alter table public.tasks add constraint tasks_schedule_params check (coalesce(
  case schedule
    when 'weekly'           then cardinality(weekdays) = 1
    when 'weekdays'         then cardinality(weekdays) >= 1
    when 'every_x_days'     then repeat_every is not null
    when 'monthly'          then month_day is not null
    when 'every_x_weeks'    then repeat_every is not null and cardinality(weekdays) = 1
    when 'every_x_months'   then repeat_every is not null and month_day is not null
    when 'yearly'           then month_day is not null and month is not null
    when 'after_completion' then repeat_every is not null
    else true
  end, false));

-- Existing tasks were one-off tasks created on their creation day.
update public.tasks set start_date = (created_at at time zone 'Europe/Zurich')::date;

-- ---------------------------------------------------------------------------
-- Occurrences
-- ---------------------------------------------------------------------------

create table public.task_occurrences (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.tasks (id) on delete cascade,
  family_id  uuid not null references public.families (id) on delete cascade,
  due_date   date not null,
  -- Stars at the time the occurrence was created, so editing a task later
  -- doesn't rewrite anybody's history.
  reward     int not null check (reward > 0),
  claimed_by uuid references public.family_members (id) on delete set null,
  claimed_at timestamptz,
  is_done    boolean not null default false,
  done_at    timestamptz,
  created_at timestamptz not null default now(),
  unique (task_id, due_date)
);

create index task_occurrences_family_id_idx on public.task_occurrences (family_id);
create index task_occurrences_claimed_by_idx on public.task_occurrences (claimed_by, done_at);

-- Move claim / completion state over: one occurrence per existing task.
insert into public.task_occurrences
  (task_id, family_id, due_date, reward, claimed_by, claimed_at, is_done, done_at, created_at)
select id, family_id, start_date, reward, claimed_by, claimed_at, is_done, done_at, created_at
from public.tasks;

-- ---------------------------------------------------------------------------
-- Drop the per-task state (now on occurrences)
-- ---------------------------------------------------------------------------

drop view public.member_week_stars;

alter table public.tasks
  drop column claimed_by,
  drop column claimed_at,
  drop column is_done,
  drop column done_at;

/** tasks: fills family_id from the creator's family (the MCP server only sends title + user_id). */
create or replace function public.tasks_before_write()
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

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Scheduling
-- ---------------------------------------------------------------------------

/** Whether a task with a fixed schedule falls on day d (not for after_completion). */
create function private.task_due_on(t public.tasks, d date)
returns boolean
language sql
stable
set search_path = ''
as $$
  with m as (
    select
      extract(day from d)::int as day,
      extract(day from date_trunc('month', d) + interval '1 month - 1 day')::int as last_day,
      extract(isodow from d)::smallint as isodow
  )
  select d >= t.start_date and case t.schedule
    when 'once'           then d = t.start_date
    when 'daily'          then true
    when 'weekly'         then m.isodow = any (t.weekdays)
    when 'weekdays'       then m.isodow = any (t.weekdays)
    when 'every_x_days'   then (d - t.start_date) % t.repeat_every = 0
    when 'monthly'        then m.day = least(t.month_day, m.last_day)
    when 'every_x_weeks'  then m.isodow = any (t.weekdays)
      and ((date_trunc('week', d)::date - date_trunc('week', t.start_date)::date) / 7) % t.repeat_every = 0
    when 'every_x_months' then m.day = least(t.month_day, m.last_day)
      and ((extract(year from d) * 12 + extract(month from d))
         - (extract(year from t.start_date) * 12 + extract(month from t.start_date)))::int % t.repeat_every = 0
    when 'yearly'         then extract(month from d) = t.month and m.day = least(t.month_day, m.last_day)
    else false
  end
  from m;
$$;

/** Adds the task's latest due occurrence (up to today, family time) unless it exists. */
create function private.ensure_occurrence(t public.tasks)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  tz    text;
  today date;
  due   date;
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

  insert into public.task_occurrences (task_id, family_id, due_date, reward)
  values (t.id, t.family_id, due, t.reward)
  on conflict (task_id, due_date) do nothing;
end;
$$;

/** Brings the pool of the signed-in user's families up to date. Called by the clients. */
create function public.refresh_task_pool()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tasks;
begin
  for t in
    select * from public.tasks
    where archived_at is null and private.is_family_member(family_id)
  loop
    perform private.ensure_occurrence(t);
  end loop;
end;
$$;

/** New tasks show up in the pool right away (if due today or earlier). */
create function private.tasks_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.ensure_occurrence(new);
  return null;
end;
$$;

create trigger tasks_after_insert
  after insert on public.tasks
  for each row execute function private.tasks_after_insert();

/**
 * task_occurrences: keeps claimed_at / done_at in sync with claimed_by /
 * is_done, and only lets members of the task's own family claim it.
 */
create function private.task_occurrences_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.claimed_by is not null and not exists (
    select 1 from public.family_members where id = new.claimed_by and family_id = new.family_id
  ) then
    raise exception 'Member % is not part of this family', new.claimed_by;
  end if;

  if tg_op = 'INSERT' then
    new.claimed_at := coalesce(new.claimed_at, case when new.claimed_by is not null then now() end);
    new.done_at := coalesce(new.done_at, case when new.is_done then now() end);
  else
    if new.claimed_by is distinct from old.claimed_by then
      new.claimed_at := case when new.claimed_by is null then null else now() end;
    end if;

    if new.is_done and not old.is_done then
      new.done_at := now();
    elsif not new.is_done then
      new.done_at := null;
    end if;
  end if;

  return new;
end;
$$;

create trigger task_occurrences_before_write
  before insert or update on public.task_occurrences
  for each row execute function private.task_occurrences_before_write();

-- Helpers are internal; only refresh_task_pool is part of the API.
revoke execute on function private.task_due_on(public.tasks, date) from public, anon, authenticated;
revoke execute on function private.ensure_occurrence(public.tasks) from public, anon, authenticated;
revoke execute on function private.tasks_after_insert() from public, anon, authenticated;
revoke execute on function private.task_occurrences_before_write() from public, anon, authenticated;
revoke execute on function public.refresh_task_pool() from public, anon;
grant execute on function public.refresh_task_pool() to authenticated;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

-- Explicit grants: newer Supabase projects (and the local stack) no longer
-- grant table access to API roles by default. RLS still decides which rows.
grant select on public.families, public.family_members to authenticated;
grant select, insert, update, delete on public.tasks to authenticated;

-- Creating, changing and removing tasks is part of the parents' admin area;
-- every member can still see the pool and claim / tick off occurrences.
drop policy "Members can add tasks to their family" on public.tasks;
drop policy "Members can update their family's tasks" on public.tasks;
drop policy "Members can delete their family's tasks" on public.tasks;

-- The before-insert trigger fills family_id before this check runs.
create policy "Parents can add tasks to their family"
  on public.tasks for insert
  to authenticated
  with check ((select auth.uid()) = user_id and private.is_family_parent(family_id));

create policy "Parents can update their family's tasks"
  on public.tasks for update
  to authenticated
  using (private.is_family_parent(family_id))
  with check (private.is_family_parent(family_id));

create policy "Parents can delete their family's tasks"
  on public.tasks for delete
  to authenticated
  using (private.is_family_parent(family_id));

alter table public.task_occurrences enable row level security;

-- Occurrences are created by refresh_task_pool / the insert trigger and go
-- away with their task; clients only claim and tick them off.
revoke all on public.task_occurrences from anon, authenticated;
grant select on public.task_occurrences to authenticated;
grant update (claimed_by, is_done) on public.task_occurrences to authenticated;

create policy "Members can view their family's occurrences"
  on public.task_occurrences for select
  to authenticated
  using (private.is_family_member(family_id));

create policy "Members can claim and finish their family's occurrences"
  on public.task_occurrences for update
  to authenticated
  using (private.is_family_member(family_id))
  with check (private.is_family_member(family_id));

-- ---------------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------------

/** The pool: latest occurrence per active task, while open or on the day it was done. */
create view public.task_pool
with (security_invoker = true)
as
select
  o.id,
  o.task_id,
  o.family_id,
  o.due_date,
  o.reward,
  o.claimed_by,
  o.is_done,
  o.done_at,
  t.title,
  t.emoji,
  t.color,
  t.schedule
from (
  select distinct on (task_id) *
  from public.task_occurrences
  order by task_id, due_date desc
) o
join public.tasks t on t.id = o.task_id
join public.families f on f.id = o.family_id
where t.archived_at is null
  and (not o.is_done or (o.done_at at time zone f.timezone)::date = (now() at time zone f.timezone)::date);

create view public.member_week_stars
with (security_invoker = true)
as
select
  m.id        as member_id,
  m.family_id,
  coalesce(sum(o.reward), 0)::int as stars
from public.family_members m
join public.families f on f.id = m.family_id
left join public.task_occurrences o
  on o.claimed_by = m.id
 and o.is_done
 and o.done_at >= (date_trunc('week', now() at time zone f.timezone) at time zone f.timezone)
group by m.id, m.family_id;

grant select on public.task_pool, public.member_week_stars to authenticated;
