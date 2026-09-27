import { Component, computed, inject, input, resource, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { supabase } from '../../core/supabase-client';
import { PoolColor, TaskPool } from '../tasks/task-pool';

/** A finished occurrence with its task's title / emoji / colour. */
interface DoneTask {
  /** Occurrence id. */
  id: string;
  title: string;
  emoji: string;
  color: PoolColor;
  reward: number;
  done_at: string;
}

interface Day {
  key: string;
  date: Date;
  stars: number;
}

type Range = 14 | 30;

/** Chart geometry in viewBox units (the SVG scales to the card width). */
const W = 900;
const H = 220;
const PAD = { left: 28, right: 10, top: 14, bottom: 26 };
const PLOT_H = H - PAD.top - PAD.bottom;

/** Local calendar day, e.g. "2026-09-27". */
function dayKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * "Plan-Fortschritt" of one family member: stars earned per day and the tasks
 * they finished, based on their finished task_occurrences.
 */
@Component({
  selector: 'app-progress',
  imports: [RouterLink],
  templateUrl: './progress.html',
  styleUrl: './progress.scss',
})
export class Progress {
  protected readonly pool = inject(TaskPool);

  /** Route parameter :memberId. */
  readonly memberId = input.required<string>();

  protected readonly range = signal<Range>(14);
  protected readonly hovered = signal<number | null>(null);

  protected readonly member = computed(() => this.pool.member(this.memberId()));

  /** "Mias", "Klaus'" — German genitive for the page title. */
  protected readonly possessive = computed(() => {
    const name = this.member()?.name ?? '';
    return /[sxzß]$/i.test(name) ? `${name}’` : `${name}s`;
  });

  /** Everything the member finished in the last 30 days (the longest range), newest first. */
  protected readonly done = resource({
    // Depends on pool.tasks() so ticking a task off in the pool refreshes this page too.
    params: () => ({ memberId: this.memberId(), poolTasks: this.pool.tasks() }),
    loader: async ({ params }) => {
      const since = startOfDay(new Date());
      since.setDate(since.getDate() - 29);

      const { data, error } = await supabase
        .from('task_occurrences')
        .select('id, reward, done_at, task:tasks(title, emoji, color)')
        .eq('claimed_by', params.memberId)
        .eq('is_done', true)
        .gte('done_at', since.toISOString())
        .order('done_at', { ascending: false });

      if (error) {
        throw new Error(error.message, { cause: error });
      }

      // Flatten the embedded task; reward is the one stored on the occurrence.
      type Row = Pick<DoneTask, 'id' | 'reward' | 'done_at'> & {
        task: Pick<DoneTask, 'title' | 'emoji' | 'color'>;
      };
      return (data as unknown as Row[]).map(({ task, ...rest }) => ({ ...rest, ...task }));
    },
  });

  /** One entry per day of the selected range, oldest first, today last. */
  protected readonly days = computed<Day[]>(() => {
    const starsByDay = new Map<string, number>();
    for (const task of this.done.value() ?? []) {
      const key = dayKey(new Date(task.done_at));
      starsByDay.set(key, (starsByDay.get(key) ?? 0) + task.reward);
    }

    const today = startOfDay(new Date());
    return Array.from({ length: this.range() }, (_, i) => {
      const date = new Date(today);
      date.setDate(today.getDate() - (this.range() - 1 - i));
      const key = dayKey(date);
      return { key, date, stars: starsByDay.get(key) ?? 0 };
    });
  });

  /** Finished tasks inside the selected range. */
  protected readonly inRange = computed(() => {
    const first = this.days()[0].date.getTime();
    return (this.done.value() ?? []).filter((t) => new Date(t.done_at).getTime() >= first);
  });

  protected readonly bestDay = computed(() => {
    const best = this.days().reduce((a, b) => (b.stars >= a.stars ? b : a));
    return best.stars > 0 ? best : null;
  });

  /** History grouped by day ("Heute", "Gestern", "Mittwoch, 23. September"). */
  protected readonly history = computed(() => {
    const groups: { label: string; tasks: DoneTask[] }[] = [];
    let lastKey: string | null = null;

    for (const task of this.inRange()) {
      const date = new Date(task.done_at);
      const key = dayKey(date);
      if (key !== lastKey) {
        groups.push({ label: this.dayLabel(date), tasks: [] });
        lastKey = key;
      }
      groups.at(-1)!.tasks.push(task);
    }

    return groups;
  });

  // ---------------------------------------------------------------------------
  // Chart
  // ---------------------------------------------------------------------------

  protected readonly viewBox = `0 0 ${W} ${H}`;
  protected readonly chartWidth = W;
  protected readonly chartHeight = H;
  protected readonly plotLeft = PAD.left;
  protected readonly plotRight = W - PAD.right;
  protected readonly axisY = H - 8;

  /** Y-axis maximum: at least 6 stars, rounded up to an even number. */
  private readonly niceMax = computed(
    () => Math.ceil(Math.max(6, ...this.days().map((d) => d.stars)) / 2) * 2,
  );

  protected readonly ticks = computed(() => {
    const max = this.niceMax();
    return [0, max / 2, max].map((value) => ({ value, y: this.yFor(value) }));
  });

  protected readonly bars = computed(() => {
    const days = this.days();
    const slot = (W - PAD.left - PAD.right) / days.length;
    const width = Math.min(24, slot * 0.55);
    const todayKey = dayKey(new Date());

    return days.map((day, i) => {
      const cx = PAD.left + slot * i + slot / 2;
      const top = day.stars ? this.yFor(day.stars) : this.yFor(0) - 3;
      return {
        day,
        cx,
        top,
        slotX: cx - slot / 2,
        slotW: slot,
        path: this.barPath(cx - width / 2, top, width, this.yFor(0) - top, day.stars ? 4 : 1.5),
        // Every day for 14 days; every 4th (plus today) for 30.
        label: days.length <= 14 || i % 4 === 0 || i === days.length - 1 ? this.weekday(day.date) : null,
        isToday: day.key === todayKey,
      };
    });
  });

  protected setRange(range: Range): void {
    this.range.set(range);
    this.hovered.set(null);
  }

  protected barLabel(day: Day): string {
    return `${this.longDate(day.date)}: ${day.stars} Sterne`;
  }

  protected weekday(date: Date): string {
    return date.toLocaleDateString('de-DE', { weekday: 'short' }).replace('.', '');
  }

  protected longDate(date: Date): string {
    return date.toLocaleDateString('de-DE', { day: 'numeric', month: 'long' });
  }

  protected time(iso: string): string {
    return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  }

  private yFor(value: number): number {
    return PAD.top + PLOT_H - (value / this.niceMax()) * PLOT_H;
  }

  /** Bar with rounded top corners, flat on the baseline. */
  private barPath(x: number, y: number, w: number, h: number, r: number): string {
    r = Math.min(r, w / 2, h);
    return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
  }

  private dayLabel(date: Date): string {
    const diff = Math.round((startOfDay(new Date()).getTime() - startOfDay(date).getTime()) / 86_400_000);
    if (diff === 0) return 'Heute';
    if (diff === 1) return 'Gestern';
    return date.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
  }
}
