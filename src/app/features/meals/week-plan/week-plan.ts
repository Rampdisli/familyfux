import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TaskPool } from '../../tasks/task-pool';
import { MealTabs } from '../meal-tabs/meal-tabs';
import {
  DAYS_PER_WEEK,
  MAX_WEEKS_AHEAD,
  MEAL_SLOTS,
  MealSlot,
  Meals,
  PlannedMeal,
  addDays,
  cssImage,
  isoDate,
  today,
} from '../meals';
import { WhoPicker } from '../who-picker/who-picker';

const DAY_MS = 24 * 60 * 60 * 1000;

interface DayRow {
  iso: string;
  date: Date;
  isToday: boolean;
  meals: { slot: MealSlot; planned: PlannedMeal | undefined }[];
}

/** The slot the recipe picker is open for. */
interface PickerTarget {
  day: string;
  slot: MealSlot;
  title: string;
  planned: PlannedMeal | undefined;
}

/** "Wochenplan" — design/prototypes/fuxis-plan-wochenplan.html */
@Component({
  selector: 'app-week-plan',
  imports: [MealTabs, RouterLink, WhoPicker],
  templateUrl: './week-plan.html',
  styleUrl: './week-plan.scss',
  host: {
    '(document:keydown.escape)': 'picker.set(null)',
  },
})
export class WeekPlan {
  protected readonly meals = inject(Meals);
  protected readonly pool = inject(TaskPool);

  protected readonly slots = MEAL_SLOTS;
  protected readonly background = cssImage;

  protected readonly picker = signal<PickerTarget | null>(null);

  protected readonly start = computed(() => addDays(today(), this.meals.weekOffset() * DAYS_PER_WEEK));

  protected readonly days = computed((): DayRow[] => {
    const planned = this.meals.weekData.value()?.meals ?? [];
    const todayIso = isoDate(today());

    return Array.from({ length: DAYS_PER_WEEK }, (_, i) => {
      const date = addDays(this.start(), i);
      const iso = isoDate(date);
      return {
        iso,
        date,
        isToday: iso === todayIso,
        meals: MEAL_SLOTS.map(({ slot }) => ({
          slot,
          planned: planned.find((m) => m.day === iso && m.meal === slot),
        })),
      };
    });
  });

  protected readonly weekLabel = computed(() => {
    const end = this.short(addDays(this.start(), DAYS_PER_WEEK - 1));
    return this.meals.weekOffset() === 0 ? `Heute – ${end}` : `${this.short(this.start())} – ${end}`;
  });

  /** Paging back stops at the week of the oldest planned meal. */
  protected readonly minOffset = computed(() => {
    const first = this.meals.weekData.value()?.firstDay;
    if (!first) {
      return 0;
    }
    const daysBack = Math.round((today().getTime() - new Date(`${first}T00:00:00`).getTime()) / DAY_MS);
    return Math.min(0, -Math.ceil(daysBack / DAYS_PER_WEEK));
  });

  protected readonly maxOffset = MAX_WEEKS_AHEAD;

  /** Recipes offered in the picker: what can be cooked right away first. */
  protected readonly choices = computed(() =>
    [...this.meals.suggested()].sort(
      (a, b) => Number(b.ingredients_available) - Number(a.ingredients_available) || a.title.localeCompare(b.title, 'de'),
    ),
  );

  protected short(date: Date): string {
    return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
  }

  protected weekday(date: Date): string {
    return date.toLocaleDateString('de-DE', { weekday: 'short' }).replace('.', '');
  }

  protected slotLabel(slot: MealSlot): string {
    return MEAL_SLOTS.find((s) => s.slot === slot)!.label;
  }

  protected wishers(meal: PlannedMeal) {
    return this.pool.family().filter((m) => meal.wishers.includes(m.id));
  }

  protected iWish(meal: PlannedMeal): boolean {
    const me = this.meals.activeMemberId();
    return !!me && meal.wishers.includes(me);
  }

  protected page(delta: number): void {
    this.meals.weekOffset.update((o) => Math.min(this.maxOffset, Math.max(this.minOffset(), o + delta)));
  }

  protected toggleWish(event: Event, meal: PlannedMeal): void {
    event.stopPropagation();
    const me = this.meals.activeMemberId();
    if (me) {
      void this.meals.toggleMealWish(meal, me);
    }
  }

  protected openPicker(day: DayRow, slot: MealSlot, planned: PlannedMeal | undefined): void {
    const weekday = day.date.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit' });
    this.picker.set({ day: day.iso, slot, planned, title: `${this.slotLabel(slot)} am ${weekday}` });
  }

  protected choose(recipeId: string): void {
    const target = this.picker();
    this.picker.set(null);
    if (target && recipeId !== target.planned?.recipe_id) {
      void this.meals.planMeal(target.day, target.slot, recipeId);
    }
  }

  protected clear(): void {
    const planned = this.picker()?.planned;
    this.picker.set(null);
    if (planned) {
      void this.meals.removeMeal(planned);
    }
  }
}
