-- Parents can remove a finished entry from a member's history ("Erledigte
-- Aufgaben" on the progress page): a finished part of a pool entry
-- (task_claims) or a completion of a repeatable task (task_completions).
--
-- Removing sets removed_at instead of deleting the row:
-- - the pool entry stays done — deleting the last claim would make
--   task_claims_after_write reopen it, and the task would come back;
-- - the other participants of a shared ("split") entry keep their share —
--   it's counted over all participants, removed ones included.
-- Removed entries no longer count anywhere: claim_rewards (week stars,
-- progress, task history) and today's counter of repeatable tasks skip them.

alter table public.task_claims
  add column removed_at timestamptz,
  add column removed_by uuid references auth.users (id) on delete set null;

alter table public.task_completions
  add column removed_at timestamptz,
  add column removed_by uuid references auth.users (id) on delete set null;

-- A removed part can't be ticked off or on again.
drop policy "Members can tick off their family's claims" on public.task_claims;

create policy "Members can tick off their family's claims"
  on public.task_claims for update
  to authenticated
  using (private.is_family_member(family_id) and removed_at is null)
  with check (private.is_family_member(family_id));

/**
 * Removes a finished entry (a done task_claims row or a task_completions row,
 * by id) from the history. Parents only; resolves to false if there is no
 * such finished entry the caller may remove.
 */
create function public.remove_done_entry(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.task_claims
  set removed_at = now(), removed_by = (select auth.uid())
  where id = p_id
    and is_done
    and removed_at is null
    and private.is_family_parent(family_id);
  if found then
    return true;
  end if;

  update public.task_completions
  set removed_at = now(), removed_by = (select auth.uid())
  where id = p_id
    and removed_at is null
    and private.is_family_parent(family_id);
  return found;
end;
$$;

revoke execute on function public.remove_done_entry(uuid) from public, anon;
grant execute on function public.remove_done_entry(uuid) to authenticated;

/**
 * Stars per participant: the full reward, or an equal share of it — plus one
 * row per completion of a repeatable task (occurrence_id is null there).
 * Removed entries are left out; a share is still split over all participants.
 */
create or replace view public.claim_rewards
with (security_invoker = true)
as
select id, occurrence_id, family_id, member_id, claimed_at, is_done, done_at, task_id, due_date, stars
from (
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
    end as stars,
    c.removed_at
  from public.task_claims c
  join public.task_occurrences o on o.id = c.occurrence_id
) claims
where removed_at is null
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
join public.families f on f.id = tc.family_id
where tc.removed_at is null;

/** Today's completions (family time zone): the "3× heute" counter. */
create or replace view public.task_completions_today
with (security_invoker = true)
as
select c.id, c.task_id, c.family_id, c.member_id, c.reward, c.completed_at
from public.task_completions c
join public.families f on f.id = c.family_id
where (c.completed_at at time zone f.timezone)::date = (now() at time zone f.timezone)::date
  and c.removed_at is null;
