import { Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TaskPool } from '../../tasks/task-pool';
import { Ingredient, Meals, Rating, Recipe, cssImage, ingredientLabel, recipeSource } from '../meals';

/** Ingredient chips shown on a card; the rest are counted. */
const VISIBLE_INGREDIENTS = 3;

/** One recipe on "Was gibt's zu essen?": availability, 👍 / 👎 and "Das will ich!". */
@Component({
  selector: 'app-recipe-card',
  imports: [RouterLink],
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
  protected readonly label = ingredientLabel;

  /** Recipe details (image, name and ingredients open them). */
  protected readonly detailLink = computed(() => ['/essen/rezept', this.recipe().id]);
  /** Tells the details they were opened from the list, so closing goes back in the history. */
  protected readonly fromList = { fromList: true };

  /** Ingredients that differ from the original recipe (changed, added, left out). */
  protected readonly deviations = computed(
    () => this.recipe().ingredients.filter((i) => i.status !== 'original').length,
  );

  /** "Wer wünscht sich das?" */
  protected readonly pickerOpen = signal(false);

  protected readonly likers = computed(() => this.pool.family().filter((m) => this.recipe().ratings[m.id] === 'up'));
  protected readonly wishers = computed(() => this.pool.family().filter((m) => this.recipe().wishers.includes(m.id)));

  /** The "Ich bin:" member's 👍 / 👎. */
  protected readonly myRating = computed(() => {
    const me = this.meals.activeMemberId();
    return me ? this.recipe().ratings[me] : undefined;
  });

  /** Tooltip: what the original recipe said. */
  protected hint(ingredient: Ingredient): string {
    switch (ingredient.status) {
      case 'changed':
        return `Angepasst — im Original: ${ingredientLabel(ingredient, true)}`;
      case 'added':
        return 'Ergänzt — nicht im Original';
      case 'removed':
        return 'Weggelassen — steht im Original';
      default:
        return '';
    }
  }

  protected rate(value: Rating): void {
    const me = this.meals.activeMemberId();
    if (me) {
      void this.meals.rate(this.recipe(), me, value);
    }
  }
}
