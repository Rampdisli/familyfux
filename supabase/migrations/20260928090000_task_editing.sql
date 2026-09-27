-- "Aufgaben verwalten": parents edit, delete (archive) and restore tasks.
--
-- Deleting never removes history: it sets archived_at, which takes the task
-- out of the pool; its finished occurrences stay. Restoring clears it again.

-- Only the task's own fields can be edited (not user_id / family_id / id).
revoke update on public.tasks from anon, authenticated;
grant update (title, emoji, color, reward, schedule, start_date, repeat_every, weekdays, month_day, month, archived_at)
  on public.tasks to authenticated;

/**
 * Keeps the pool in line with an edited task:
 * - schedule changed → open occurrences follow the new schedule (they are
 *   replaced; finished ones stay untouched)
 * - reward changed   → open occurrences pay the new reward, finished ones keep theirs
 * - restored         → the task gets its current occurrence right away
 */
create function private.tasks_after_update()
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

  if new.reward is distinct from old.reward then
    update public.task_occurrences set reward = new.reward where task_id = new.id and not is_done;
  end if;

  return null;
end;
$$;

revoke execute on function private.tasks_after_update() from public, anon, authenticated;

create trigger tasks_after_update
  after update on public.tasks
  for each row execute function private.tasks_after_update();
