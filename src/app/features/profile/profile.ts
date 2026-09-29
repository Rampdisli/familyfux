import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, resource, signal } from '@angular/core';
import { supabase } from '../../core/supabase-client';
import { FuxiHero } from '../rewards/fuxi-hero';
import { PURCHASE_COLUMNS, Purchase, Rewards } from '../rewards/rewards';
import { PoolColor, TaskPool, formatStars } from '../tasks/task-pool';

/** A finished entry (claim_rewards row) with its task's title / emoji / colour. */
interface DoneTask {
  /** The finished part (task_claims) or completion of a repeatable task (task_completions). */
  id: string;
  title: string;
  emoji: string;
  color: PoolColor;
  /** Full reward, or this member's share of it. */
  stars: number;
  done_at: string;
}

/** One line of the "Sterne-Verlauf": stars earned, or a purchase. */
type HistoryEntry =
  | { kind: 'earned'; at: string; entry: DoneTask }
  | { kind: 'spent'; at: string; purchase: Purchase };

type HistoryFilter = 'all' | 'earned' | 'spent';

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
 * "Profil" — design/prototypes/fuxis-plan-belohnungen.html
 *
 * Always about the person picked in the brown bar: open rewards, stats, the
 * stars they earned per day and the "Sterne-Verlauf" (earned stars, and for
 * their purchases). With "Alle" picked: the family's open rewards only.
 */
@Component({
  selector: 'app-profile',
  imports: [FuxiHero, NgTemplateOutlet],
  templateUrl: './profile.html',
  styleUrl: './profile.scss',
})
export class Profile {
  protected readonly pool = inject(TaskPool);
  protected readonly rewards = inject(Rewards);

  protected readonly member = computed(() => this.pool.selectedMember());
  private readonly memberId = computed(() => this.member()?.id ?? null);
  protected readonly isKid = computed(() => this.member()?.role === 'child');

  protected readonly range = signal<Range>(14);
  protected readonly hovered = signal<number | null>(null);
  protected readonly historyFilter = signal<HistoryFilter>('all');
  protected readonly historyFilters: { key: HistoryFilter; label: string }[] = [
    { key: 'all', label: 'Alle' },
    { key: 'earned', label: 'Verdient' },
    { key: 'spent', label: 'Eingelöst' },
  ];

  /** Open rewards shown: a kid's own, or the whole family's (parents tick them off; "Alle"). */
  protected readonly openRewards = computed(() => {
    const open = this.rewards.open();
    return this.isKid() ? open.filter((p) => p.member_id === this.memberId()) : open;
  });

  /** The purchase being ticked off fades out before the list reloads without it. */
  protected readonly leaving = signal<string | null>(null);
  protected readonly confirmError = signal<string | null>(null);

  /** History entry whose delete / cancel button was clicked once (the second click does it). */
  protected readonly removeArmed = signal<string | null>(null);
  protected readonly removing = signal<string | null>(null);
  protected readonly removeError = signal<string | null>(null);

  /** Everything the member finished and bought in the last 30 days (the longest range), newest first. */
  protected readonly done = resource({
    // Depends on pool.tasks() / the open purchases so ticking off or buying elsewhere refreshes this page too.
    params: () => ({
      memberId: this.memberId(),
      poolTasks: this.pool.tasks(),
      open: this.rewards.open(),
    }),
    loader: async ({ params }) => {
      if (!params.memberId) {
        return { earned: [], spent: [] };
      }

      const since = startOfDay(new Date());
      since.setDate(since.getDate() - 29);

      const purchases = await supabase
        .from('reward_purchases')
        .select(PURCHASE_COLUMNS)
        .eq('member_id', params.memberId)
        .gte('purchased_at', since.toISOString())
        .order('purchased_at', { ascending: false });

      if (purchases.error) {
        throw new Error(purchases.error.message, { cause: purchases.error });
      }

      // The member's finished parts, with their stars (full reward or their share).
      const claims = await supabase
        .from('claim_rewards')
        .select('id, task_id, done_at, stars')
        .eq('member_id', params.memberId)
        .eq('is_done', true)
        .gte('done_at', since.toISOString())
        .order('done_at', { ascending: false });

      if (claims.error) {
        throw new Error(claims.error.message, { cause: claims.error });
      }

      const rows = claims.data as (Pick<DoneTask, 'id' | 'done_at' | 'stars'> & { task_id: string })[];
      const tasks = rows.length
        ? await supabase
            .from('tasks')
            .select('id, title, emoji, color')
            .in('id', [...new Set(rows.map((r) => r.task_id))])
        : { data: [], error: null };

      if (tasks.error) {
        throw new Error(tasks.error.message, { cause: tasks.error });
      }

      const byId = new Map((tasks.data as (Pick<DoneTask, 'title' | 'emoji' | 'color'> & { id: string })[]).map((t) => [t.id, t]));
      return {
        // Task fields first: the entry's own id must win over the task's.
        earned: rows.map(({ task_id, stars, ...claim }): DoneTask => ({ ...byId.get(task_id)!, ...claim, stars: Number(stars) })),
        spent: purchases.data as Purchase[],
      };
    },
  });

  /** One entry per day of the selected range, oldest first, today last. */
  protected readonly days = computed<Day[]>(() => {
    const starsByDay = new Map<string, number>();
    for (const task of this.done.value()?.earned ?? []) {
      const key = dayKey(new Date(task.done_at));
      starsByDay.set(key, (starsByDay.get(key) ?? 0) + task.stars);
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
    return (this.done.value()?.earned ?? []).filter((t) => new Date(t.done_at).getTime() >= first);
  });

  /** Purchases inside the selected range. */
  private readonly spentInRange = computed(() => {
    const first = this.days()[0].date.getTime();
    return (this.done.value()?.spent ?? []).filter((p) => new Date(p.purchased_at).getTime() >= first);
  });

  protected readonly bestDay = computed(() => {
    const best = this.days().reduce((a, b) => (b.stars >= a.stars ? b : a));
    return best.stars > 0 ? best : null;
  });

  /** "Sterne-Verlauf": earned stars and purchases, newest first, grouped by day ("Heute", "Gestern", "Mittwoch, 23. September"). */
  protected readonly history = computed(() => {
    const filter = this.historyFilter();
    const entries: HistoryEntry[] = [
      ...(filter === 'spent' ? [] : this.inRange().map((entry) => ({ kind: 'earned' as const, at: entry.done_at, entry }))),
      ...(filter === 'earned'
        ? []
        : this.spentInRange().map((purchase) => ({ kind: 'spent' as const, at: purchase.purchased_at, purchase }))),
    ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

    const groups: { label: string; entries: HistoryEntry[] }[] = [];
    let lastKey: string | null = null;

    for (const entry of entries) {
      const date = new Date(entry.at);
      const key = dayKey(date);
      if (key !== lastKey) {
        groups.push({ label: this.dayLabel(date), entries: [] });
        lastKey = key;
      }
      groups.at(-1)!.entries.push(entry);
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

  /** Parents: they got it — the card fades out, the purchase counts as redeemed. */
  protected async confirm(purchase: Purchase): Promise<void> {
    this.leaving.set(purchase.id);
    this.confirmError.set(null);
    await new Promise((resolve) => setTimeout(resolve, 220));
    this.confirmError.set(await this.rewards.confirm(purchase.id));
    this.leaving.set(null);
  }

  /** Parents: first click arms "↩️" ("Storno?"), the second cancels the purchase; the stars come back. */
  protected async cancel(purchase: Purchase): Promise<void> {
    if (this.removeArmed() !== purchase.id) {
      this.removeArmed.set(purchase.id);
      return;
    }

    this.removeArmed.set(null);
    this.removing.set(purchase.id);
    this.removeError.set(null);
    const error = await this.rewards.cancel(purchase.id);
    if (error) {
      this.removeError.set(error);
    }
    this.removing.set(null);
  }

  /**
   * Parents only: first click arms the button, the second removes the entry
   * from the history (and its stars); the task itself stays done.
   */
  protected async remove(task: DoneTask): Promise<void> {
    if (this.removeArmed() !== task.id) {
      this.removeArmed.set(task.id);
      return;
    }

    this.removeArmed.set(null);
    this.removing.set(task.id);
    this.removeError.set(null);

    const { data, error } = await supabase.rpc('remove_done_entry', { p_id: task.id });
    if (error || !data) {
      this.removeError.set(error?.message ?? 'Der Eintrag ist schon weg, oder du darfst ihn nicht löschen.');
    }

    // Reloads the stars and the balance, and this page's history with them.
    this.pool.data.reload();
    this.removing.set(null);
  }

  protected memberName(id: string | null): string {
    return this.pool.member(id)?.name ?? 'Ehemaliges Mitglied';
  }

  /** "heute", "gestern", "Freitag", or "12. September" — when a purchase was made. */
  protected purchaseDay(iso: string): string {
    const date = new Date(iso);
    const diff = Math.round((startOfDay(new Date()).getTime() - startOfDay(date).getTime()) / 86_400_000);
    if (diff === 0) return 'heute';
    if (diff === 1) return 'gestern';
    if (diff < 7) return date.toLocaleDateString('de-DE', { weekday: 'long' });
    return this.longDate(date);
  }

  protected setRange(range: Range): void {
    this.range.set(range);
    this.hovered.set(null);
  }

  protected barLabel(day: Day): string {
    return `${this.longDate(day.date)}: ${day.stars} Sterne`;
  }

  protected stars(stars: number): string {
    return formatStars(stars);
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
