/**
 * Task schedules — mirrors the `schedule` column of `tasks` and its parameters
 * (see supabase/migrations/20260927200000_task_schedules_and_occurrences.sql).
 */

export type Schedule =
  | 'once'
  | 'daily'
  | 'weekly'
  | 'weekdays'
  | 'every_x_days'
  | 'monthly'
  | 'every_x_weeks'
  | 'every_x_months'
  | 'yearly'
  | 'after_completion';

export type RecurringSchedule = Exclude<Schedule, 'once'>;

export interface ScheduleParams {
  schedule: Schedule;
  /** ISO date (yyyy-mm-dd): the day of a one-off task, or when a recurring one starts. */
  start_date: string;
  repeat_every: number | null;
  /** ISO weekdays, 1 = Monday … 7 = Sunday. */
  weekdays: number[] | null;
  month_day: number | null;
  month: number | null;
}

/** Options of the "Wiederholung" select, in the order of the design. */
export const RECURRING_OPTIONS: { value: RecurringSchedule; label: string }[] = [
  { value: 'daily', label: 'Täglich' },
  { value: 'weekly', label: 'Wöchentlich (an einem Tag)' },
  { value: 'weekdays', label: 'An bestimmten Wochentagen' },
  { value: 'every_x_days', label: 'Alle X Tage' },
  { value: 'monthly', label: 'Monatlich (an einem Tag im Monat)' },
  { value: 'every_x_weeks', label: 'Alle X Wochen' },
  { value: 'every_x_months', label: 'Alle X Monate' },
  { value: 'yearly', label: 'Jährlich' },
  { value: 'after_completion', label: 'X Tage nach letzter Erledigung' },
];

export const WEEKDAYS_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
export const WEEKDAYS_LONG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
export const MONTHS = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

/** Everything the "Neue Aufgabe" form can set; only the fields of the chosen schedule get saved. */
export interface ScheduleDraft {
  recurring: boolean;
  onceDate: string;
  schedule: RecurringSchedule;
  startDate: string;
  /** For 'weekly' / 'every_x_weeks' (ISO weekday). */
  weekday: number;
  /** For 'weekdays' (ISO weekdays). */
  weekdays: number[];
  everyXDays: number;
  everyXWeeks: number;
  everyXMonths: number;
  daysAfterDone: number;
  monthDay: number;
  month: number;
}

/** Only the parameters the chosen schedule needs (the DB check rejects anything inconsistent). */
export function toScheduleParams(draft: ScheduleDraft): ScheduleParams {
  const params: ScheduleParams = {
    schedule: draft.recurring ? draft.schedule : 'once',
    start_date: draft.recurring ? draft.startDate : draft.onceDate,
    repeat_every: null,
    weekdays: null,
    month_day: null,
    month: null,
  };

  switch (params.schedule) {
    case 'weekly':
      return { ...params, weekdays: [draft.weekday] };
    case 'weekdays':
      return { ...params, weekdays: [...draft.weekdays].sort() };
    case 'every_x_days':
      return { ...params, repeat_every: draft.everyXDays };
    case 'monthly':
      return { ...params, month_day: draft.monthDay };
    case 'every_x_weeks':
      return { ...params, repeat_every: draft.everyXWeeks, weekdays: [draft.weekday] };
    case 'every_x_months':
      return { ...params, repeat_every: draft.everyXMonths, month_day: draft.monthDay };
    case 'yearly':
      return { ...params, month_day: draft.monthDay, month: draft.month };
    case 'after_completion':
      return { ...params, repeat_every: draft.daysAfterDone };
    default:
      return params;
  }
}

/** "Wird jede Woche am Montag angezeigt" — the summary under the form and in the preview. */
export function scheduleSummary(draft: ScheduleDraft): string {
  const day = WEEKDAYS_LONG[draft.weekday - 1];

  switch (draft.schedule) {
    case 'daily':
      return 'Wird jeden Tag im Pool angezeigt';
    case 'weekly':
      return `Wird jede Woche am ${day} angezeigt`;
    case 'weekdays':
      return `Wird angezeigt an: ${[...draft.weekdays].sort().map((d) => WEEKDAYS_LONG[d - 1]).join(', ')}`;
    case 'every_x_days':
      return `Wird alle ${draft.everyXDays} Tage angezeigt`;
    case 'monthly':
      return `Wird jeden Monat am ${draft.monthDay}. angezeigt`;
    case 'every_x_weeks':
      return `Wird alle ${draft.everyXWeeks} Wochen am ${day} angezeigt`;
    case 'every_x_months':
      return `Wird alle ${draft.everyXMonths} Monate am ${draft.monthDay}. angezeigt`;
    case 'yearly':
      return `Wird jedes Jahr am ${draft.monthDay}. ${MONTHS[draft.month - 1]} angezeigt`;
    case 'after_completion':
      return `Erscheint ${draft.daysAfterDone} Tage nach der letzten Erledigung wieder`;
  }
}

/** Local calendar day as yyyy-mm-dd (what <input type="date"> uses). */
export function isoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Form state for a new task: one-off today, recurring fields prefilled with today's weekday / day. */
export function defaultScheduleDraft(): ScheduleDraft {
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

/** Form state for editing a stored task (the inverse of toScheduleParams). */
export function scheduleDraftFrom(params: ScheduleParams): ScheduleDraft {
  const draft = defaultScheduleDraft();
  const every = params.repeat_every ?? undefined;

  if (params.schedule === 'once') {
    return { ...draft, recurring: false, onceDate: params.start_date };
  }

  return {
    ...draft,
    recurring: true,
    schedule: params.schedule,
    startDate: params.start_date,
    weekday: params.weekdays?.[0] ?? draft.weekday,
    weekdays: params.weekdays?.length ? [...params.weekdays] : draft.weekdays,
    everyXDays: params.schedule === 'every_x_days' ? every! : draft.everyXDays,
    everyXWeeks: params.schedule === 'every_x_weeks' ? every! : draft.everyXWeeks,
    everyXMonths: params.schedule === 'every_x_months' ? every! : draft.everyXMonths,
    daysAfterDone: params.schedule === 'after_completion' ? every! : draft.daysAfterDone,
    monthDay: params.month_day ?? draft.monthDay,
    month: params.month ?? draft.month,
  };
}

/** Short label for lists: "Täglich", "An: Montag, Donnerstag", "Einmalig am 14. September 2026". */
export function scheduleLabel(params: ScheduleParams): string {
  const days = (params.weekdays ?? []).map((d) => WEEKDAYS_LONG[d - 1]).join(', ');

  switch (params.schedule) {
    case 'once':
      return `Einmalig am ${new Date(`${params.start_date}T00:00`).toLocaleDateString('de-DE', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })}`;
    case 'daily':
      return 'Täglich';
    case 'weekly':
      return `Wöchentlich am ${days}`;
    case 'weekdays':
      return `An: ${days}`;
    case 'every_x_days':
      return `Alle ${params.repeat_every} Tage`;
    case 'monthly':
      return `Monatlich am ${params.month_day}.`;
    case 'every_x_weeks':
      return `Alle ${params.repeat_every} Wochen am ${days}`;
    case 'every_x_months':
      return `Alle ${params.repeat_every} Monate am ${params.month_day}.`;
    case 'yearly':
      return `Jährlich am ${params.month_day}. ${MONTHS[(params.month ?? 1) - 1]}`;
    case 'after_completion':
      return `${params.repeat_every} Tage nach letzter Erledigung`;
  }
}
