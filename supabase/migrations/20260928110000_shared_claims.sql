-- Several family members can take on the same pool entry together.
--
--   tasks.reward_mode  'each'  → every participant earns the full reward
--                      'split' → the reward is shared (3 ⭐ for 2 → 1.5 ⭐ each)
--   task_claims        one row per participant of an occurrence; everybody
--                      ticks off their own part
--
-- An occurrence counts as done once all of its participants are done
-- (task_occurrences.is_done / done_at are kept in sync by a trigger), so the
-- pool, "after completion" schedules and the progress pages keep working on
-- occurrences as before. Stars per participant come from the claim_rewards view.

-- ---------------------------------------------------------------------------
-- Reward mode
-- ---------------------------------------------------------------------------

alter table public.tasks
  add column reward_mode text not null default 'each' check (reward_mode in ('each', 'split'));

grant update (reward_mode) on public.tasks to authenticated;

-- ---------------------------------------------------------------------------
-- Occurrences: claim state moves to task_claims
-- ---------------------------------------------------------------------------

drop view public.task_pool;
drop view public.member_week_stars;

drop policy "Members can claim and finish their family's occurrences" on public.task_occurrences;
drop trigger task_occurrences_before_write on public.task_occurrences;
drop function private.task_occurrences_before_write();

revoke update on public.task_occurrences from authenticated;

alter table public.task_occurrences
  drop column claimed_by,
  drop column claimed_at,
  -- Snapshot, like reward: editing the task later doesn't rewrite history.
  add column reward_mode text not null default 'each' check (reward_mode in ('each', 'split'));

comment on column public.task_occurrences.is_done is 'All participants (task_claims) are done. Maintained by trigger.';
comment on column public.task_occurrences.done_at is 'When the last participant finished. Maintained by trigger.';

/** Adds the task's latest due occurrence (up to today, family time) unless it exists. */
create or replace function private.ensure_occurrence(t public.tasks)
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

  insert into public.task_occurrences (task_id, family_id, due_date, reward, reward_mode)
  values (t.id, t.family_id, due, t.reward, t.reward_mode)
  on conflict (task_id, due_date) do nothing;
end;
$$;

/** Edited task → open occurrences follow the new schedule / reward / reward mode. */
create or replace function private.tasks_after_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.schedule, new.start_date, new.repeat_every, new.weekdays, new.month_day, new.month)
     is distinct from
     (old.schedule, old.start_date, old.repeat_every, old.weekdays, old.month_day, old.month) then
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
-- Claims
-- ---------------------------------------------------------------------------

create table public.task_claims (
  id            uuid primary key default gen_random_uuid(),
  occurrence_id uuid not null references public.task_occurrences (id) on delete cascade,
  family_id     uuid not null references public.families (id) on delete cascade,
  -- set null: removing a member keeps the occurrence's state (and the other
  -- participants' split) as it was
  member_id     uuid references public.family_members (id) on delete set null,
  claimed_at    timestamptz not null default now(),
  is_done       boolean not null default false,
  done_at       timestamptz,
  unique (occurrence_id, member_id)
);

create index task_claims_member_id_idx on public.task_claims (member_id, done_at);
create index task_claims_family_id_idx on public.task_claims (family_id);

/** Fills family_id, checks the member belongs to it, keeps done_at in sync with is_done. */
create function private.task_claims_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    select family_id into new.family_id from public.task_occurrences where id = new.occurrence_id;

    if not exists (
      select 1 from public.family_members where id = new.member_id and family_id = new.family_id
    ) then
      raise exception 'Member % is not part of this family', new.member_id;
    end if;

    new.done_at := case when new.is_done then now() end;
  elsif new.is_done is distinct from old.is_done then
    new.done_at := case when new.is_done then now() end;
  end if;

  return new;
end;
$$;

create trigger task_claims_before_write
  before insert or update on public.task_claims
  for each row execute function private.task_claims_before_write();

/** Recomputes the occurrence's is_done / done_at: done once every participant is. */
create function private.task_claims_after_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  occ uuid := coalesce(new.occurrence_id, old.occurrence_id);
  all_done boolean;
  last_done timestamptz;
begin
  select coalesce(bool_and(is_done), false), max(done_at) into all_done, last_done
  from public.task_claims
  where occurrence_id = occ;

  update public.task_occurrences
  set is_done = all_done, done_at = case when all_done then last_done end
  where id = occ and (is_done, done_at) is distinct from (all_done, case when all_done then last_done end);

  return null;
end;
$$;

create trigger task_claims_after_write
  after insert or update or delete on public.task_claims
  for each row execute function private.task_claims_after_write();

revoke execute on function private.task_claims_before_write() from public, anon, authenticated;
revoke execute on function private.task_claims_after_write() from public, anon, authenticated;

alter table public.task_claims enable row level security;

revoke all on public.task_claims from anon, authenticated;
grant select, delete on public.task_claims to authenticated;
grant insert (occurrence_id, member_id, is_done) on public.task_claims to authenticated;
grant update (is_done) on public.task_claims to authenticated;

create policy "Members can view their family's claims"
  on public.task_claims for select
  to authenticated
  using (private.is_family_member(family_id));

-- The before-insert trigger fills family_id before this check runs.
create policy "Members can join their family's tasks"
  on public.task_claims for insert
  to authenticated
  with check (private.is_family_member(family_id));

create policy "Members can tick off their family's claims"
  on public.task_claims for update
  to authenticated
  using (private.is_family_member(family_id))
  with check (private.is_family_member(family_id));

-- Finished parts stay (they carry stars); tick them off first to step out.
create policy "Members can step out of unfinished claims"
  on public.task_claims for delete
  to authenticated
  using (private.is_family_member(family_id) and not is_done);

-- ---------------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------------

/** Stars per participant: the full reward, or an equal share of it. */
create view public.claim_rewards
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
join public.task_occurrences o on o.id = c.occurrence_id;

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
  o.reward_mode,
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
  coalesce(sum(r.stars), 0) as stars
from public.family_members m
join public.families f on f.id = m.family_id
left join public.claim_rewards r
  on r.member_id = m.id
 and r.is_done
 and r.done_at >= (date_trunc('week', now() at time zone f.timezone) at time zone f.timezone)
group by m.id, m.family_id;

grant select on public.claim_rewards, public.task_pool, public.member_week_stars to authenticated;
