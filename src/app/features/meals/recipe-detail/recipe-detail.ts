import { Location } from '@angular/common';
import {
  Component,
  ElementRef,
  OnDestroy,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  resource,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { supabase } from '../../../core/supabase-client';
import { TaskPool } from '../../tasks/task-pool';
import { Ingredient, MealSlot, Meals, Rating, ingredientLabel, recipeSource } from '../meals';

/**
 * Recipe details ("Rezept-Detailansicht") — the Claude Doc of the same name and
 * its design (artifact "Rezept-Detailansicht"): full screen on phones, an
 * overlay over the recipe list from 768 px. Route /essen/rezept/:id, so the
 * back gesture closes it and it can be linked to directly.
 */

/** A lunch / dinner of this recipe (a row of meals). */
interface RecipeMeal {
  day: string;
  meal: MealSlot;
}

/** What's planned today in the family (for "Heute gekocht" replacing another recipe). */
interface TodayMeal extends RecipeMeal {
  recipe_id: string;
}

const MEAL_LABELS: Record<MealSlot, string> = { lunch: 'Mittagessen', dinner: 'Abendessen' };
const WEEKDAYS_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const WEEKDAYS_LONG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

/** A calendar day (yyyy-mm-dd) as a UTC date, so formatting never shifts it by a time zone. */
function utcDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Today (yyyy-mm-dd) and the hour in the family's time zone — not the browser's, not UTC. */
function nowIn(timeZone: string): { day: string; hour: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  );
  return { day: `${parts['year']}-${parts['month']}-${parts['day']}`, hour: Number(parts['hour']) };
}

/** Lunch before dinner on the same day. */
const slotOrder = (m: RecipeMeal) => (m.meal === 'lunch' ? 0 : 1);

const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

@Component({
  selector: 'app-recipe-detail',
  templateUrl: './recipe-detail.html',
  styleUrl: './recipe-detail.scss',
  host: {
    '(document:keydown.escape)': 'close()',
  },
})
export class RecipeDetail implements OnDestroy {
  protected readonly meals = inject(Meals);
  protected readonly pool = inject(TaskPool);
  private readonly router = inject(Router);
  private readonly location = inject(Location);

  /** Route parameter :id. */
  readonly id = input.required<string>();
  /** Query parameter ?zutat=<ingredient id>: opened from an ingredient on the card. */
  readonly zutat = input<string>();

  private readonly dialog = viewChild.required<ElementRef<HTMLElement>>('dialog');
  private readonly closeButton = viewChild.required<ElementRef<HTMLButtonElement>>('closeButton');

  /** What had focus before opening (the card's image, name or ingredient) gets it back on close. */
  private readonly opener = document.activeElement as HTMLElement | null;
  /** Opened from the list (not a direct link): closing goes back in the history. */
  private readonly fromList = !!(history.state as { fromList?: boolean } | null)?.fromList;

  protected readonly recipe = computed(() => this.meals.recipe(this.id()));

  /** Meals of this recipe, ratings with their time, the family's "today" and what's planned today. */
  protected readonly details = resource({
    // Reloads with the recipes, e.g. after "Heute gekocht" or a 👍.
    params: () => ({ id: this.id(), recipes: this.meals.recipes() }),
    loader: async ({ params }) => {
      const family = await supabase.from('families').select('timezone').limit(1).maybeSingle();
      const now = nowIn((family.data?.timezone as string | undefined) ?? 'Europe/Zurich');

      const [meals, ratings, today] = await Promise.all([
        supabase.from('meals').select('day, meal').eq('recipe_id', params.id).order('day'),
        supabase.from('recipe_ratings').select('member_id, rating, rated_at').eq('recipe_id', params.id),
        supabase.from('meals').select('day, meal, recipe_id').eq('day', now.day),
      ]);

      const error = family.error ?? meals.error ?? ratings.error ?? today.error;
      if (error) {
        throw new Error(error.message, { cause: error });
      }

      return {
        today: now.day,
        hour: now.hour,
        meals: (meals.data ?? []) as RecipeMeal[],
        ratings: (ratings.data ?? []) as { member_id: string; rating: Rating; rated_at: string | null }[],
        todayMeals: (today.data ?? []) as TodayMeal[],
      };
    },
  });

  protected readonly today = computed(() => this.details.value()?.today ?? null);

  /** From today on, next first. Today counts as planned. */
  protected readonly planned = computed(() => {
    const today = this.today();
    return (this.details.value()?.meals ?? [])
      .filter((m) => today && m.day >= today)
      .sort((a, b) => a.day.localeCompare(b.day) || slotOrder(a) - slotOrder(b));
  });

  /** Before today, newest first: every past meal counts as cooked. */
  protected readonly cooked = computed(() => {
    const today = this.today();
    return (this.details.value()?.meals ?? [])
      .filter((m) => today && m.day < today)
      .sort((a, b) => b.day.localeCompare(a.day) || slotOrder(b) - slotOrder(a));
  });

  /** Every family member with their rating (none = "offen"). */
  protected readonly people = computed(() => {
    const ratings = new Map((this.details.value()?.ratings ?? []).map((r) => [r.member_id, r]));
    return this.pool.family().map((member) => ({ member, rating: ratings.get(member.id) ?? null }));
  });

  protected readonly likes = computed(() => this.people().filter((p) => p.rating?.rating === 'up').length);

  /** The "Ich bin:" member's 👍 (the like toggle on the photo). */
  protected readonly liked = computed(() => {
    const me = this.meals.activeMemberId();
    return !!me && this.recipe()?.ratings[me] === 'up';
  });
  protected readonly me = computed(() => this.pool.member(this.meals.activeMemberId()));

  /** "2 angepasst · 1 ergänzt · 1 weggelassen"; null when everything is as in the original. */
  protected readonly deviations = computed(() => {
    const ingredients = this.recipe()?.ingredients ?? [];
    const count = (status: Ingredient['status']) => ingredients.filter((i) => i.status === status).length;
    const parts = [
      [count('changed'), 'angepasst'],
      [count('added'), 'ergänzt'],
      [count('removed'), 'weggelassen'],
    ]
      .filter(([n]) => n)
      .map(([n, label]) => `${n} ${label}`);
    return parts.length ? parts.join(' · ') : null;
  });

  /** Ingredients actually used (left-out ones don't count). */
  protected readonly ingredientCount = computed(
    () => (this.recipe()?.ingredients ?? []).filter((i) => i.status !== 'removed').length,
  );

  // "Heute gekocht"
  protected readonly cookOpen = signal(false);
  protected readonly cookSlot = signal<MealSlot>('lunch');
  protected readonly saving = signal(false);
  protected readonly actionError = signal<string | null>(null);

  /** Already on today's plan: the button reads "Heute eingeplant". */
  protected readonly plannedToday = computed(() => this.planned().some((m) => m.day === this.today()));

  /** Another recipe that "Heute gekocht" would replace in the chosen slot. */
  protected readonly replaces = computed(() => {
    const other = this.details.value()?.todayMeals.find((m) => m.meal === this.cookSlot() && m.recipe_id !== this.id());
    return other ? (this.meals.recipe(other.recipe_id)?.title ?? 'ein anderes Rezept') : null;
  });

  protected readonly highlighted = signal<string | null>(null);

  protected readonly label = ingredientLabel;
  protected readonly mealLabel = MEAL_LABELS;

  private readonly previousOverflow = document.body.style.overflow;

  constructor() {
    // The page underneath doesn't scroll while the details are open.
    document.body.style.overflow = 'hidden';

    afterNextRender(() => this.closeButton().nativeElement.focus({ preventScroll: true }));

    // Opened from an ingredient: scroll to it and mark it for a moment.
    effect((onCleanup) => {
      const id = this.zutat();
      if (!id || !this.recipe()) {
        return;
      }
      const timers = [
        setTimeout(() => {
          document.getElementById(`zutat-${id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
          this.highlighted.set(id);
        }, 150),
        setTimeout(() => this.highlighted.set(null), 2200),
      ];
      onCleanup(() => timers.forEach(clearTimeout));
    });
  }

  ngOnDestroy(): void {
    document.body.style.overflow = this.previousOverflow;
    if (this.opener?.isConnected) {
      this.opener.focus({ preventScroll: true });
    }
  }

  /** X, Esc, scrim: back to the list — through the history if we came from it, so "back" stays in step. */
  close(): void {
    if (this.fromList) {
      this.location.back();
    } else {
      void this.router.navigate(['/essen']);
    }
  }

  /** Scrim (overlay only): a click outside the dialog closes it. */
  protected onBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.close();
    }
  }

  /** Keeps Tab inside the dialog. */
  protected trapFocus(event: KeyboardEvent): void {
    if (event.key !== 'Tab') {
      return;
    }
    const focusable = Array.from(this.dialog().nativeElement.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (el) => el.offsetParent !== null,
    );
    if (!focusable.length) {
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  protected async toggleLike(): Promise<void> {
    const recipe = this.recipe();
    const me = this.meals.activeMemberId();
    if (recipe && me) {
      // The same 👍 again takes it back.
      await this.meals.rate(recipe, me, 'up');
    }
  }

  /** "Einplanen": the week plan is where meals are planned. */
  protected plan(): void {
    void this.router.navigate(['/essen/wochenplan']);
  }

  protected openCook(): void {
    // Before 3 pm (family time) it's lunch.
    this.cookSlot.set((this.details.value()?.hour ?? 12) < 15 ? 'lunch' : 'dinner');
    this.actionError.set(null);
    this.cookOpen.set(true);
  }

  protected async saveCooked(): Promise<void> {
    const today = this.today();
    if (!today) {
      return;
    }
    this.saving.set(true);
    const error = await this.meals.cookedToday(today, this.cookSlot(), this.id());
    this.saving.set(false);
    this.actionError.set(error);
    if (!error) {
      this.cookOpen.set(false);
    }
  }

  protected source(url: string | null): string {
    return recipeSource(url);
  }

  protected host(url: string): string {
    try {
      const u = new URL(url);
      return (u.hostname.replace(/^www\./, '') + u.pathname + u.search).replace(/\/$/, '');
    } catch {
      return url;
    }
  }

  /** "So, 20. Sep 2026" */
  protected date(day: string): string {
    const d = utcDay(day);
    return `${WEEKDAYS_SHORT[d.getUTCDay()]}, ${d.getUTCDate()}. ${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  }

  /** "5. Jul 2026" from a timestamp (rated_at / created_at). */
  protected since(iso: string): string {
    const d = new Date(iso);
    return `${d.getDate()}. ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
  }

  protected calendarDay(day: string): { day: number; month: string; weekday: string } {
    const d = utcDay(day);
    return { day: d.getUTCDate(), month: MONTHS_SHORT[d.getUTCMonth()], weekday: WEEKDAYS_LONG[d.getUTCDay()] };
  }

  /** "heute", "morgen", "in 3 Tagen". */
  protected relative(day: string): string {
    const today = this.today();
    if (!today) {
      return '';
    }
    const diff = Math.round((utcDay(day).getTime() - utcDay(today).getTime()) / 86_400_000);
    return diff === 0 ? 'heute' : diff === 1 ? 'morgen' : `in ${diff} Tagen`;
  }

}
