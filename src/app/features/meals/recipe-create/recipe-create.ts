import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Meals } from '../meals';
import { RecipeForm } from '../recipe-form/recipe-form';
import { newRecipeDraft, recipeInput, usedIngredients, webUrl } from '../recipe-form/recipe-draft';
import { RecipePreview } from '../recipe-preview/recipe-preview';

/** "Rezept importieren": a Fooby / Cookidoo link or an own recipe, typed in by hand. */
@Component({
  selector: 'app-recipe-create',
  imports: [RecipeForm, RecipePreview, RouterLink],
  templateUrl: './recipe-create.html',
  styleUrl: './recipe-create.scss',
})
export class RecipeCreate {
  private readonly meals = inject(Meals);
  private readonly router = inject(Router);

  protected readonly draft = signal(newRecipeDraft());
  protected readonly saving = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  protected readonly link = computed(() => webUrl(this.draft().url));
  protected readonly image = computed(() => webUrl(this.draft().imageUrl));
  protected readonly ingredients = computed(() => usedIngredients(this.draft().rows));

  protected async save(): Promise<void> {
    this.saving.set(true);
    this.errorMessage.set(null);

    const error = await this.meals.createRecipe(recipeInput(this.draft()));

    this.saving.set(false);

    if (error) {
      this.errorMessage.set(error);
    } else {
      void this.router.navigateByUrl('/essen');
    }
  }
}
