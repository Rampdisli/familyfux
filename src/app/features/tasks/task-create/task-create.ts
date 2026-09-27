import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  MONTHS,
  RECURRING_OPTIONS,
  RecurringSchedule,
  ScheduleDraft,
  WEEKDAYS_SHORT,
  scheduleSummary,
  toScheduleParams,
} from '../schedule';
import { POOL_COLORS, PoolColor, TaskPool } from '../task-pool';

/** Local calendar day as yyyy-mm-dd (what <input type="date"> uses). */
function isoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** "Neue Aufgabe erstellen" — design/prototypes/fuxis-plan-aufgabe-erstellen.html */
@Component({
  selector: 'app-task-create',
  imports: [NgTemplateOutlet, RouterLink],
  templateUrl: './task-create.html',
  styleUrl: './task-create.scss',
})
export class TaskCreate {
  private readonly pool = inject(TaskPool);
  private readonly router = inject(Router);

  protected readonly icons = ['🧸', '🦷', '🎒', '🐕', '🍽️', '🧺', '🌱', '🗑️', '📚', '🧹', '🚲', '🛏️'];
  protected readonly colors = POOL_COLORS;
  protected readonly recurringOptions = RECURRING_OPTIONS;
  protected readonly weekdays = WEEKDAYS_SHORT;
  protected readonly months = MONTHS;

  protected readonly title = signal('');
  protected readonly emoji = signal(this.icons[0]);
  protected readonly color = signal<PoolColor>(POOL_COLORS[0]);
  protected readonly reward = signal(3);
  protected readonly schedule = signal<ScheduleDraft>(this.defaultSchedule());

  protected readonly saving = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  protected readonly summary = computed(() => scheduleSummary(this.schedule()));

  /** Day options: 1–31, but for yearly tasks only days that exist in the chosen month (29. Februar is fine). */
  protected readonly monthDays = computed(() => {
    const { schedule, month } = this.schedule();
    const days = schedule === 'yearly' ? new Date(2024, month, 0).getDate() : 31;
    return Array.from({ length: days }, (_, i) => i + 1);
  });

  /** Day 29–31 on a monthly/yearly schedule: the DB moves it to the last day of shorter months. */
  protected readonly lateMonthDay = computed(() => {
    const { schedule, monthDay } = this.schedule();
    return monthDay > 28 && ['monthly', 'every_x_months', 'yearly'].includes(schedule);
  });
  protected readonly canSave = computed(() => this.title().trim().length > 0 && !this.saving());

  protected changeReward(delta: number): void {
    this.reward.update((stars) => Math.min(10, Math.max(1, stars + delta)));
  }

  protected patchSchedule(changes: Partial<ScheduleDraft>): void {
    this.schedule.update((draft) => ({ ...draft, ...changes }));
  }

  protected setScheduleType(value: string): void {
    this.patchSchedule({ schedule: value as RecurringSchedule });
    this.patchSchedule({ monthDay: Math.min(this.schedule().monthDay, this.monthDays().at(-1)!) });
  }

  /** Number fields: whole numbers within [min, max]; empty or invalid input keeps the old value. */
  protected setNumber(
    field: 'everyXDays' | 'everyXWeeks' | 'everyXMonths' | 'daysAfterDone' | 'monthDay' | 'month',
    raw: string,
    min: number,
    max: number,
  ): void {
    const value = Number.parseInt(raw, 10);
    if (Number.isFinite(value)) {
      this.patchSchedule({ [field]: Math.min(max, Math.max(min, value)) });
    }

    // Switching the month of a yearly task from e.g. March to February: 31 → 29.
    const lastDay = this.monthDays().at(-1)!;
    if (this.schedule().monthDay > lastDay) {
      this.patchSchedule({ monthDay: lastDay });
    }
  }

  /** Multi-select weekdays; the last selected day can't be removed. */
  protected toggleWeekday(day: number): void {
    const days = this.schedule().weekdays;
    if (!days.includes(day)) {
      this.patchSchedule({ weekdays: [...days, day] });
    } else if (days.length > 1) {
      this.patchSchedule({ weekdays: days.filter((d) => d !== day) });
    }
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
      ...toScheduleParams(this.schedule()),
    });

    this.saving.set(false);

    if (error) {
      this.errorMessage.set(error);
    } else {
      void this.router.navigateByUrl('/tasks');
    }
  }

  private defaultSchedule(): ScheduleDraft {
    const today = new Date();
    const isoWeekday = ((today.getDay() + 6) % 7) + 1;

    return {
      recurring: false,
      onceDate: isoDate(today),
      schedule: 'daily',
      startDate: isoDate(today),
      weekday: isoWeekday,
      weekdays: [isoWeekday],
      everyXDays: 2,
      everyXWeeks: 2,
      everyXMonths: 2,
      daysAfterDone: 3,
      monthDay: today.getDate(),
      month: today.getMonth() + 1,
    };
  }
}
