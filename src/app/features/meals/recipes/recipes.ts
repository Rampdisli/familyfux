import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { TaskPool } from '../../tasks/task-pool';
import { MealTabs } from '../meal-tabs/meal-tabs';
import { Meals, Recipe, cssImage } from '../meals';
import { RecipeCard } from '../recipe-card/recipe-card';
import { WhoPicker } from '../who-picker/who-picker';

type Filter = 'all' | 'available';
type Sort = 'smart' | 'cooked' | 'alpha';

/** "Was gibt's zu essen?" — design/prototypes/fuxis-plan-mahlzeiten.html */
@Component({
  selector: 'app-recipes',
  imports: [MealTabs, RecipeCard, RouterLink, RouterOutlet, WhoPicker],
  templateUrl: './recipes.html',
  styleUrl: './recipes.scss',
})
export class Recipes {
  protected readonly meals = inject(Meals);
  protected readonly pool = inject(TaskPool);

  protected readonly background = cssImage;

  protected readonly filter = signal<Filter>('all');
  protected readonly sort = signal<Sort>('smart');
  protected readonly hiddenOpen = signal(false);

  protected readonly visible = computed(() => {
    const list = this.meals.suggested().filter((r) => this.filter() === 'all' || r.ingredients_available);

    switch (this.sort()) {
      case 'alpha':
        return list.sort((a, b) => a.title.localeCompare(b.title, 'de'));
      case 'cooked':
        // Longest not cooked first; never cooked before everything else.
        return list.sort((a, b) => (a.last_cooked_on ?? '').localeCompare(b.last_cooked_on ?? ''));
      default:
        // What can be cooked right away first, then the family favourites.
        return list.sort(
          (a, b) => Number(b.ingredients_available) - Number(a.ingredients_available) || b.cook_count - a.cook_count,
        );
    }
  });

  /** "Heutige Wünsche": recipes somebody wished for today. */
  protected readonly wished = computed(() => this.meals.recipes().filter((r) => r.wishers.length));

  protected wisherEmojis(recipe: Recipe): string {
    return this.pool
      .family()
      .filter((m) => recipe.wishers.includes(m.id))
      .map((m) => m.emoji)
      .join('');
  }

  protected setSort(event: Event): void {
    this.sort.set((event.target as HTMLSelectElement).value as Sort);
  }
}
