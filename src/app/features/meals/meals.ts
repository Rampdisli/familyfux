import { Injectable, computed, inject, linkedSignal, resource, signal } from '@angular/core';
import { Auth } from '../../core/auth';
import { supabase } from '../../core/supabase-client';
import { TaskPool } from '../tasks/task-pool';

export type Rating = 'up' | 'down';

export type MealSlot = 'lunch' | 'dinner';

export const MEAL_SLOTS: readonly { slot: MealSlot; icon: string; label: string }[] = [
  { slot: 'lunch', icon: '☀️', label: 'Mittag' },
  { slot: 'dinner', icon: '🌙', label: 'Abend' },
];

/** Days shown per week in the week plan. */
export const DAYS_PER_WEEK = 7;

/** How many weeks ahead the week plan goes. */
export const MAX_WEEKS_AHEAD = 4;

/**
 * How an ingredient relates to the original recipe (recipe_ingredients.status):
 * as in the original, changed ("Milch" instead of "Rahm"), added, or left out.
 */
export type IngredientStatus = 'original' | 'changed' | 'added' | 'removed';

/** One ingredient of a recipe (a row of recipe_ingredients). */
export interface Ingredient {
  id: string;
  position: number;
  /** "200 g", "1 Prise"; null for e.g. "Salz". */
  quantity: string | null;
  /** How the family cooks it; null = left out. */
  name: string | null;
  original_quantity: string | null;
  /** As in the original recipe; null = added by the family. */
  original_name: string | null;
  status: IngredientStatus;
}

/** An ingredient as typed into "Rezept importieren". */
export interface IngredientInput {
  quantity: string | null;
  name: string;
}

/** What "Rezept importieren" saves (create_recipe). */
export interface RecipeInput {
  title: string;
  url: string | null;
  image_url: string | null;
  ingredients: IngredientInput[];
  ingredients_available: boolean;
}

/** "200 g Spaghetti" — the family's version, or the original one. */
export function ingredientLabel(ingredient: Ingredient, original = false): string {
  const quantity = original ? ingredient.original_quantity : ingredient.quantity;
  const name = original ? ingredient.original_name : ingredient.name;
  return [quantity, name].filter(Boolean).join(' ');
}

export interface Recipe extends Omit<RecipeInput, 'ingredients'> {
  id: string;
  created_at: string;
  /** In recipe order, left-out ones included. */
  ingredients: Ingredient[];
  /** Planned meals up to today (recipe_stats). */
  cook_count: number;
  /** ISO date of the last planned meal up to today, if any. */
  last_cooked_on: string | null;
  /** 👍 / 👎 per member id. */
  ratings: Partial<Record<string, Rating>>;
  /** Members who wished for it today ("Das will ich!"). */
  wishers: string[];
  /** Today in the family's time zone, as the wishes store it. */
  wish_date: string | null;
}

/** One planned lunch or dinner. */
export interface PlannedMeal {
  id: string;
  day: string;
  meal: MealSlot;
  recipe_id: string;
  /** Members looking forward to it ("+ Ich auch"). */
  wishers: string[];
}

/** Local calendar date as YYYY-MM-DD (toISOString would shift it to UTC). */
export function isoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function today(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Value for [style.background-image]; null without a picture. */
export function cssImage(url: string | null): string | null {
  return url ? `url("${url.replace(/["\\]/g, '\\$&')}")` : null;
}

/** "Fooby", "Cookidoo", the site's host name, or "Eigenes Rezept" without a link. */
export function recipeSource(url: string | null): string {
  if (!url) {
    return 'Eigenes Rezept';
  }
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (host.includes('fooby')) return 'Fooby';
    if (host.includes('cookidoo')) return 'Cookidoo';
    return host;
  } catch {
    return 'Link';
  }
}

/**
 * Recipes and the meal plan of the signed-in user's family ("Essen").
 * RLS limits every query to the families the user belongs to.
 */
@Injectable({ providedIn: 'root' })
export class Meals {
  private readonly auth = inject(Auth);
  private readonly pool = inject(TaskPool);

  readonly errorMessage = signal<string | null>(null);

  /** "Ich bin:" — who ratings, wishes and planned meals are recorded for. Defaults to the signed-in member. */
  readonly activeMemberId = linkedSignal(() => this.pool.me()?.id ?? this.pool.family()[0]?.id ?? null);

  readonly recipesData = resource({
    params: () => ({ userId: this.auth.user()?.id }),
    loader: async ({ params }) => {
      if (!params.userId) {
        return null;
      }

      const [recipes, stats, ratings, wishes] = await Promise.all([
        supabase
          .from('recipes')
          .select(
            'id, title, url, image_url, ingredients_available, created_at, ' +
              'recipe_ingredients(id, position, quantity, name, original_quantity, original_name, status)',
          )
          .order('title')
          .order('position', { referencedTable: 'recipe_ingredients' }),
        supabase.from('recipe_stats').select('recipe_id, cook_count, last_cooked_on'),
        supabase.from('recipe_ratings').select('recipe_id, member_id, rating'),
        supabase.from('recipe_wishes_today').select('recipe_id, member_id, wish_date'),
      ]);

      const error = recipes.error ?? stats.error ?? ratings.error ?? wishes.error;
      if (error) {
        // PostgrestError is a plain object; resource() needs an Error to expose its message.
        throw new Error(error.message, { cause: error });
      }

      const statsById = new Map((stats.data ?? []).map((s) => [s.recipe_id as string, s]));
      const ratingRows = ratings.data ?? [];
      const wishRows = wishes.data ?? [];

      type RecipeRow = Omit<RecipeInput, 'ingredients'> & { id: string; created_at: string; recipe_ingredients: Ingredient[] };
      return ((recipes.data ?? []) as unknown as RecipeRow[]).map(
        ({ recipe_ingredients, ...r }): Recipe => ({
          ...r,
          ingredients: recipe_ingredients,
          cook_count: statsById.get(r.id)?.cook_count ?? 0,
          last_cooked_on: statsById.get(r.id)?.last_cooked_on ?? null,
          ratings: Object.fromEntries(
            ratingRows.filter((x) => x.recipe_id === r.id).map((x) => [x.member_id, x.rating as Rating]),
          ),
          wishers: wishRows.filter((w) => w.recipe_id === r.id).map((w) => w.member_id as string),
          wish_date: (wishRows[0]?.wish_date as string | undefined) ?? null,
        }),
      );
    },
  });

  readonly recipes = computed(() => this.recipesData.value() ?? []);

  /** A recipe stops being suggested once more than half of the family turned it down (4 members → 3 👎). */
  readonly hideThreshold = computed(() => Math.floor(this.pool.family().length / 2) + 1);

  /** Recipes still suggested, and the ones the family turned down. */
  readonly suggested = computed(() => this.recipes().filter((r) => !this.isHidden(r)));
  readonly hidden = computed(() => this.recipes().filter((r) => this.isHidden(r)));

  /** Week plan: 0 = today and the next six days, 1 = the seven days after, … */
  readonly weekOffset = signal(0);

  readonly weekData = resource({
    params: () => ({ userId: this.auth.user()?.id, offset: this.weekOffset() }),
    loader: async ({ params }) => {
      if (!params.userId) {
        return null;
      }

      const start = addDays(today(), params.offset * DAYS_PER_WEEK);
      const [meals, first] = await Promise.all([
        supabase
          .from('meals')
          .select('id, day, meal, recipe_id, meal_wishers(member_id)')
          .gte('day', isoDate(start))
          .lte('day', isoDate(addDays(start, DAYS_PER_WEEK - 1))),
        // The oldest planned day limits how far back the plan can be paged.
        supabase.from('meals').select('day').order('day').limit(1),
      ]);

      const error = meals.error ?? first.error;
      if (error) {
        throw new Error(error.message, { cause: error });
      }

      return {
        start,
        meals: (meals.data ?? []).map(
          ({ meal_wishers, ...m }): PlannedMeal => ({
            ...(m as Omit<PlannedMeal, 'wishers'>),
            wishers: (meal_wishers as { member_id: string }[]).map((w) => w.member_id),
          }),
        ),
        firstDay: (first.data?.[0]?.day as string | undefined) ?? null,
      };
    },
  });

  recipe(id: string): Recipe | undefined {
    return this.recipes().find((r) => r.id === id);
  }

  downVotes(recipe: Recipe): number {
    return Object.values(recipe.ratings).filter((v) => v === 'down').length;
  }

  private isHidden(recipe: Recipe): boolean {
    return this.downVotes(recipe) >= this.hideThreshold();
  }

  /**
   * Adds a recipe to the family's collection. Resolves to an error message, if any.
   * Typed in by hand, the ingredients as entered are its original.
   */
  async createRecipe(input: RecipeInput): Promise<string | null> {
    const { error } = await supabase.rpc('create_recipe', {
      p_title: input.title,
      p_url: input.url,
      p_image_url: input.image_url,
      p_ingredients_available: input.ingredients_available,
      p_ingredients: input.ingredients.map((i) => ({
        quantity: i.quantity,
        name: i.name,
        original_quantity: i.quantity,
        original_name: i.name,
      })),
    });
    this.recipesData.reload();
    return error?.message ?? null;
  }

  setAvailable(recipe: Recipe, available: boolean): Promise<void> {
    return this.write(supabase.from('recipes').update({ ingredients_available: available }).eq('id', recipe.id));
  }

  /** Sets the member's 👍 / 👎; the same value again takes it back. */
  rate(recipe: Recipe, memberId: string, value: Rating): Promise<void> {
    const current = recipe.ratings[memberId];
    const ratings = supabase.from('recipe_ratings');
    return this.write(
      current === value
        ? ratings.delete().eq('recipe_id', recipe.id).eq('member_id', memberId)
        : current
          ? ratings.update({ rating: value }).eq('recipe_id', recipe.id).eq('member_id', memberId)
          : ratings.insert({ recipe_id: recipe.id, member_id: memberId, rating: value }),
    );
  }

  /** "Wieder vorschlagen": forgets all ratings of a turned-down recipe. */
  restore(recipe: Recipe): Promise<void> {
    return this.write(supabase.from('recipe_ratings').delete().eq('recipe_id', recipe.id));
  }

  /** Today's "Das will ich!" of a member, on or off. */
  toggleWish(recipe: Recipe, memberId: string): Promise<void> {
    const wishes = supabase.from('recipe_wishes');
    return this.write(
      recipe.wishers.includes(memberId)
        ? wishes.delete().eq('recipe_id', recipe.id).eq('member_id', memberId).eq('wish_date', recipe.wish_date!)
        : wishes.insert({ recipe_id: recipe.id, member_id: memberId }),
    );
  }

  /** Puts a recipe on a day's lunch / dinner (replacing what was there); the active member is its first wisher. */
  planMeal(day: string, meal: MealSlot, recipeId: string): Promise<void> {
    return this.write(
      supabase.rpc('plan_meal', {
        p_day: day,
        p_meal: meal,
        p_recipe_id: recipeId,
        p_member_id: this.activeMemberId(),
      }),
      true,
    );
  }

  /**
   * "Heute gekocht" in the recipe details: puts the recipe on today's lunch or
   * dinner (replacing what was planned there), without a wisher.
   */
  cookedToday(day: string, meal: MealSlot, recipeId: string): Promise<string | null> {
    return this.writeResult(
      supabase.rpc('plan_meal', { p_day: day, p_meal: meal, p_recipe_id: recipeId, p_member_id: null }),
    );
  }

  removeMeal(meal: PlannedMeal): Promise<void> {
    return this.write(supabase.from('meals').delete().eq('id', meal.id), true);
  }

  /** "+ Ich auch" / "Nicht mehr ich" on a planned meal. */
  toggleMealWish(meal: PlannedMeal, memberId: string): Promise<void> {
    const wishers = supabase.from('meal_wishers');
    return this.write(
      meal.wishers.includes(memberId)
        ? wishers.delete().eq('meal_id', meal.id).eq('member_id', memberId)
        : wishers.insert({ meal_id: meal.id, member_id: memberId }),
      true,
    );
  }

  /** Like write(), for a dialog that shows the error itself: resolves to the error message, if any. */
  private async writeResult(query: PromiseLike<{ error: { message: string } | null }>): Promise<string | null> {
    const { error } = await query;
    this.weekData.reload();
    this.recipesData.reload();
    return error?.message ?? null;
  }

  /** Runs a write, shows its error above the page and reloads what it touched. */
  private async write(query: PromiseLike<{ error: { message: string } | null }>, plan = false): Promise<void> {
    this.errorMessage.set(null);

    const { error } = await query;
    if (error) {
      this.errorMessage.set(error.message);
    }

    // Reload in any case: shows the change, or reverts it on error.
    if (plan) {
      this.weekData.reload();
    }
    // Planned meals change how often a recipe was cooked.
    this.recipesData.reload();
  }
}
