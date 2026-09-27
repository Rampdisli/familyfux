import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, model } from '@angular/core';
import {
  MONTHS,
  RECURRING_OPTIONS,
  RecurringSchedule,
  ScheduleDraft,
  WEEKDAYS_SHORT,
  scheduleSummary,
} from '../schedule';

/**
 * The schedule part of the task form: the date of a one-off task, or the
 * repetition of a recurring one (whether it recurs is toggled by the page).
 * Used by "Neue Aufgabe" and "Aufgaben verwalten".
 *
 * Colours of fields and the recurrence panel can be tuned by the page via
 * --field-bg and --panel-bg.
 */
@Component({
  selector: 'app-schedule-editor',
  imports: [NgTemplateOutlet],
  templateUrl: './schedule-editor.html',
  styleUrl: './schedule-editor.scss',
})
export class ScheduleEditor {
  readonly draft = model.required<ScheduleDraft>();

  protected readonly recurringOptions = RECURRING_OPTIONS;
  protected readonly weekdays = WEEKDAYS_SHORT;
  protected readonly months = MONTHS;

  protected readonly summary = computed(() => scheduleSummary(this.draft()));

  /** Day options: 1–31, but for yearly tasks only days that exist in the chosen month (29. Februar is fine). */
  protected readonly monthDays = computed(() => {
    const { schedule, month } = this.draft();
    const days = schedule === 'yearly' ? new Date(2024, month, 0).getDate() : 31;
    return Array.from({ length: days }, (_, i) => i + 1);
  });

  /** Day 29–31 on a monthly/yearly schedule: the DB moves it to the last day of shorter months. */
  protected readonly lateMonthDay = computed(() => {
    const { schedule, monthDay } = this.draft();
    return monthDay > 28 && ['monthly', 'every_x_months', 'yearly'].includes(schedule);
  });

  protected patch(changes: Partial<ScheduleDraft>): void {
    this.draft.update((draft) => ({ ...draft, ...changes }));
  }

  protected setScheduleType(value: string): void {
    this.patch({ schedule: value as RecurringSchedule });
    this.clampMonthDay();
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
      this.patch({ [field]: Math.min(max, Math.max(min, value)) });
    }
    this.clampMonthDay();
  }

  /** Multi-select weekdays; the last selected day can't be removed. */
  protected toggleWeekday(day: number): void {
    const days = this.draft().weekdays;
    if (!days.includes(day)) {
      this.patch({ weekdays: [...days, day] });
    } else if (days.length > 1) {
      this.patch({ weekdays: days.filter((d) => d !== day) });
    }
  }

  /** Switching the month of a yearly task from e.g. March to February: 31 → 29. */
  private clampMonthDay(): void {
    const lastDay = this.monthDays().at(-1)!;
    if (this.draft().monthDay > lastDay) {
      this.patch({ monthDay: lastDay });
    }
  }
}
