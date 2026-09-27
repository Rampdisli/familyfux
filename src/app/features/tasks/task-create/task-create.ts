import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ScheduleDraft, defaultScheduleDraft, scheduleSummary, toScheduleParams } from '../schedule';
import { MemberPicker } from '../member-picker/member-picker';
import { ScheduleEditor } from '../schedule-editor/schedule-editor';
import { POOL_COLORS, PoolColor, RewardMode, TASK_ICONS, TaskPool } from '../task-pool';

/** "Neue Aufgabe erstellen" — design/prototypes/fuxis-plan-aufgabe-erstellen.html */
@Component({
  selector: 'app-task-create',
  imports: [MemberPicker, RouterLink, ScheduleEditor],
  templateUrl: './task-create.html',
  styleUrl: './task-create.scss',
})
export class TaskCreate {
  protected readonly pool = inject(TaskPool);
  private readonly router = inject(Router);

  protected readonly icons = TASK_ICONS;
  protected readonly colors = POOL_COLORS;

  protected readonly title = signal('');
  protected readonly emoji = signal(this.icons[0]);
  protected readonly color = signal<PoolColor>(POOL_COLORS[0]);
  protected readonly reward = signal(3);
  protected readonly rewardMode = signal<RewardMode>('each');
  /** Optional; nobody = up for grabs in the pool. */
  protected readonly assignees = signal<string[]>([]);

  /** Assignees in family order, for the preview. */
  protected readonly assignedMembers = computed(() =>
    this.pool.family().filter((m) => this.assignees().includes(m.id)),
  );
  protected readonly assignedNames = computed(() => this.assignedMembers().map((m) => m.name).join(', '));
  protected readonly schedule = signal<ScheduleDraft>(defaultScheduleDraft());

  protected readonly saving = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  protected readonly summary = computed(() => scheduleSummary(this.schedule()));

  protected readonly canSave = computed(() => this.title().trim().length > 0 && !this.saving());

  protected changeReward(delta: number): void {
    this.reward.update((stars) => Math.min(10, Math.max(1, stars + delta)));
  }

  protected patchSchedule(changes: Partial<ScheduleDraft>): void {
    this.schedule.update((draft) => ({ ...draft, ...changes }));
  }

  protected async save(): Promise<void> {
    if (!this.canSave()) {
      return;
    }

    this.saving.set(true);
    this.errorMessage.set(null);

    const error = await this.pool.createTask({
      title: this.title().trim(),
      emoji: this.emoji(),
      color: this.color(),
      reward: this.reward(),
      reward_mode: this.rewardMode(),
      ...toScheduleParams(this.schedule()),
    }, this.assignees());

    this.saving.set(false);

    if (error) {
      this.errorMessage.set(error);
    } else {
      void this.router.navigateByUrl('/tasks');
    }
  }
}
