import { Component, computed, inject, resource, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { supabase } from '../../../core/supabase-client';
import { ScheduleDraft, ScheduleParams, scheduleDraftFrom, scheduleLabel, toScheduleParams } from '../schedule';
import { MemberPicker } from '../member-picker/member-picker';
import { ScheduleEditor } from '../schedule-editor/schedule-editor';
import { RewardStepper } from '../reward-stepper/reward-stepper';
import { POOL_COLORS, PoolColor, RewardMode, TASK_ICONS, TaskPool, formatStars } from '../task-pool';

/** A finished part of a pool entry: who, when, how many stars (a row of claim_rewards). */
interface DoneClaim {
  id: string;
  occurrence_id: string;
  member_id: string | null;
  done_at: string;
  stars: number;
}

/** A task with everything done on it, newest first. */
interface ManagedTask extends ScheduleParams {
  id: string;
  title: string;
  emoji: string;
  color: PoolColor;
  reward: number;
  reward_mode: RewardMode;
  archived_at: string | null;
  /** Assigned member ids (empty = up for grabs). */
  assignees: string[];
  done: DoneClaim[];
  /** Pool entries somebody finished a part of. */
  doneCount: number;
}

type Filter = 'all' | 'active' | 'archived';

interface EditDraft {
  title: string;
  emoji: string;
  color: PoolColor;
  reward: number;
  reward_mode: RewardMode;
  assignees: string[];
  schedule: ScheduleDraft;
}

/**
 * "Aufgaben verwalten" (parents only) — design/prototypes/fuxis-plan-aufgabenverwaltung.html
 *
 * Deleting never removes history: it archives the task, which takes it out of
 * the pool. Archived tasks stay listed (greyed out) with their history and can
 * be restored, but not edited.
 */
@Component({
  selector: 'app-task-admin',
  imports: [MemberPicker, RewardStepper, RouterLink, ScheduleEditor],
  templateUrl: './task-admin.html',
  styleUrl: './task-admin.scss',
})
export class TaskAdmin {
  protected readonly pool = inject(TaskPool);

  protected readonly colors = POOL_COLORS;

  protected readonly filter = signal<Filter>('all');
  protected readonly expanded = signal<string | null>(null);
  protected readonly editing = signal<string | null>(null);
  protected readonly deleteArmed = signal<string | null>(null);
  protected readonly draft = signal<EditDraft | null>(null);
  protected readonly saving = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  protected readonly tasks = resource({
    // Reloads with the pool, e.g. after a task was ticked off or saved here.
    params: () => ({ poolTasks: this.pool.tasks() }),
    loader: async () => {
      const [tasks, claims, assignees] = await Promise.all([
        supabase
          .from('tasks')
          .select(
            'id, title, emoji, color, reward, reward_mode, schedule, start_date, repeat_every, weekdays, month_day, month, archived_at',
          )
          .order('created_at', { ascending: false }),
        supabase
          .from('claim_rewards')
          .select('id, task_id, occurrence_id, member_id, done_at, stars')
          .eq('is_done', true)
          .order('done_at', { ascending: false }),
        supabase.from('task_assignees').select('task_id, member_id'),
      ]);

      const error = tasks.error ?? claims.error ?? assignees.error;
      if (error) {
        throw new Error(error.message, { cause: error });
      }

      const doneByTask = new Map<string, DoneClaim[]>();
      for (const { task_id, ...claim } of claims.data as (DoneClaim & { task_id: string })[]) {
        doneByTask.set(task_id, [...(doneByTask.get(task_id) ?? []), { ...claim, stars: Number(claim.stars) }]);
      }

      return (tasks.data as Omit<ManagedTask, 'done' | 'doneCount' | 'assignees'>[]).map((task) => {
        const done = doneByTask.get(task.id) ?? [];
        return {
          ...task,
          assignees: (assignees.data ?? []).filter((a) => a.task_id === task.id).map((a) => a.member_id),
          done,
          doneCount: new Set(done.map((c) => c.occurrence_id)).size,
        };
      }) satisfies ManagedTask[];
    },
  });

  protected readonly visible = computed(() => {
    const tasks = this.tasks.value() ?? [];
    switch (this.filter()) {
      case 'active':
        return tasks.filter((t) => !t.archived_at);
      case 'archived':
        return tasks.filter((t) => t.archived_at);
      default:
        return tasks;
    }
  });

  /** Symbols to pick from; keeps a task's own symbol selectable even if it's not in the default set. */
  protected readonly icons = computed(() => {
    const current = this.draft()?.emoji;
    return current && !TASK_ICONS.includes(current) ? [current, ...TASK_ICONS] : TASK_ICONS;
  });

  protected setFilter(filter: Filter): void {
    this.filter.set(filter);
    this.deleteArmed.set(null);
  }

  protected toggleHistory(task: ManagedTask): void {
    this.expanded.update((id) => (id === task.id ? null : task.id));
    this.editing.set(null);
  }

  protected edit(task: ManagedTask): void {
    this.editing.set(task.id);
    this.expanded.set(null);
    this.deleteArmed.set(null);
    this.errorMessage.set(null);
    this.draft.set({
      title: task.title,
      emoji: task.emoji,
      color: task.color,
      reward: task.reward,
      reward_mode: task.reward_mode,
      assignees: [...task.assignees],
      schedule: scheduleDraftFrom(task),
    });
  }

  protected cancelEdit(): void {
    this.editing.set(null);
    this.draft.set(null);
  }

  protected patch(changes: Partial<EditDraft>): void {
    this.draft.update((draft) => draft && { ...draft, ...changes });
  }

  protected setScheduleDraft(schedule: ScheduleDraft): void {
    this.patch({ schedule });
  }

  protected async save(task: ManagedTask): Promise<void> {
    const draft = this.draft();
    if (!draft || !draft.title.trim()) {
      return;
    }

    this.saving.set(true);
    const error = await this.pool.updateTask(task.id, {
      title: draft.title.trim(),
      emoji: draft.emoji,
      color: draft.color,
      reward: draft.reward,
      reward_mode: draft.reward_mode,
      ...toScheduleParams(draft.schedule),
    }, {
      add: draft.assignees.filter((id) => !task.assignees.includes(id)),
      remove: task.assignees.filter((id) => !draft.assignees.includes(id)),
    });
    this.saving.set(false);

    this.errorMessage.set(error);
    if (!error) {
      this.cancelEdit();
    }
  }

  /** First click arms the button (✓), the second one deletes (archives). */
  protected async remove(task: ManagedTask): Promise<void> {
    if (this.deleteArmed() !== task.id) {
      this.deleteArmed.set(task.id);
      return;
    }

    this.deleteArmed.set(null);
    this.errorMessage.set(await this.pool.setTaskArchived(task.id, true));
  }

  protected async restore(task: ManagedTask): Promise<void> {
    this.errorMessage.set(await this.pool.setTaskArchived(task.id, false));
  }

  protected label(task: ManagedTask): string {
    return scheduleLabel(task);
  }

  /** "Mia, Ben" in family order. */
  protected assigneeNames(task: ManagedTask): string {
    return this.pool
      .family()
      .filter((m) => task.assignees.includes(m.id))
      .map((m) => m.name)
      .join(', ');
  }

  protected memberName(id: string | null): string {
    return this.pool.member(id)?.name ?? 'Unbekannt';
  }

  protected memberEmoji(id: string | null): string {
    return this.pool.member(id)?.emoji ?? '❔';
  }

  protected memberColor(id: string | null): string {
    return this.pool.member(id)?.color ?? 'peach';
  }

  protected dateTime(iso: string): string {
    const date = new Date(iso);
    return (
      date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
      ' · ' +
      date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) +
      ' Uhr'
    );
  }

  protected stars(stars: number): string {
    return formatStars(stars);
  }

  protected date(iso: string): string {
    return new Date(iso).toLocaleDateString('de-DE');
  }
}
