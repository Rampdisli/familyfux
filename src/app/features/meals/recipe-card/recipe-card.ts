import { Component, computed, inject, input, signal } from '@angular/core';
import { TaskPool } from '../../tasks/task-pool';
import { Meals, Rating, Recipe, cssImage, recipeSource } from '../meals';

/** Ingredient chips shown on a card; the rest are counted. */
const VISIBLE_INGREDIENTS = 3;

/** One recipe on "Was gibt's zu essen?": availability, 👍 / 👎 and "Das will ich!". */
@Component({
  selector: 'app-recipe-card',
  templateUrl: './recipe-card.html',
  styleUrl: './recipe-card.scss',
  host: {
    '[class.missing]': '!recipe().ingredients_available',
  },
})
export class RecipeCard {
  protected readonly meals = inject(Meals);
  protected readonly pool = inject(TaskPool);

  readonly recipe = input.required<Recipe>();

  protected readonly visibleIngredients = VISIBLE_INGREDIENTS;
  protected readonly source = recipeSource;
  protected readonly background = cssImage;

  /** "Wer wünscht sich das?" */
  protected readonly pickerOpen = signal(false);

  protected readonly likers = computed(() => this.pool.family().filter((m) => this.recipe().ratings[m.id] === 'up'));
  protected readonly wishers = computed(() => this.pool.family().filter((m) => this.recipe().wishers.includes(m.id)));

  /** The "Ich bin:" member's 👍 / 👎. */
  protected readonly myRating = computed(() => {
    const me = this.meals.activeMemberId();
    return me ? this.recipe().ratings[me] : undefined;
  });

  protected rate(value: Rating): void {
    const me = this.meals.activeMemberId();
    if (me) {
      void this.meals.rate(this.recipe(), me, value);
    }
  }
}
