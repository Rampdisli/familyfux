import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Meals } from '../meals';
import { RecipeDeleteDialog } from '../recipe-delete-dialog/recipe-delete-dialog';
import { RecipeForm } from '../recipe-form/recipe-form';
import { RecipeDraft, recipeDraft, recipeEdit, usedIngredients, webUrl } from '../recipe-form/recipe-draft';
import { RecipePreview } from '../recipe-preview/recipe-preview';

/**
 * "Rezept bearbeiten" (parents only) — design/prototypes/fuxis-plan-rezept-bearbeiten.html.
 * Route /essen/rezept/:id/bearbeiten, built like "Rezept importieren".
 */
@Component({
  selector: 'app-recipe-edit',
  imports: [RecipeDeleteDialog, RecipeForm, RecipePreview, RouterLink],
  templateUrl: './recipe-edit.html',
  styleUrl: './recipe-edit.scss',
})
export class RecipeEdit {
  protected readonly meals = inject(Meals);
  private readonly router = inject(Router);

  /** Route parameter :id. */
  readonly id = input.required<string>();

  protected readonly recipe = computed(() => this.meals.recipe(this.id()));

  /** The form's values; filled once from the recipe, so later reloads don't overwrite what was typed. */
  protected readonly draft = signal<RecipeDraft | null>(null);
  /** What's saved, as update_recipe would send it — to tell whether anything changed. */
  private readonly saved = signal<string | null>(null);

  protected readonly changed = computed(() => {
    const draft = this.draft();
    return !!draft && JSON.stringify(recipeEdit(draft)) !== this.saved();
  });

  protected readonly link = computed(() => webUrl(this.draft()?.url ?? ''));
  protected readonly image = computed(() => webUrl(this.draft()?.imageUrl ?? ''));
  protected readonly ingredients = computed(() => usedIngredients(this.draft()?.rows ?? []));

  protected readonly saving = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  /** "🗑️ Rezept löschen…": the same dialog as in the recipe details. */
  protected readonly deleteOpen = signal(false);

  constructor() {
    effect(() => {
      const recipe = this.recipe();
      if (recipe && !untracked(this.draft)) {
        const draft = recipeDraft(recipe);
        this.draft.set(draft);
        this.saved.set(JSON.stringify(recipeEdit(draft)));
      }
    });
  }

  protected async save(): Promise<void> {
    const recipe = this.recipe();
    const draft = this.draft();
    if (!recipe || !draft) {
      return;
    }

    this.saving.set(true);
    this.errorMessage.set(null);
    const error = await this.meals.updateRecipe(recipe, recipeEdit(draft));
    this.saving.set(false);

    if (error) {
      this.errorMessage.set(error);
    } else {
      void this.router.navigate(['/essen/rezept', recipe.id], { state: { toast: '✓ Rezept gespeichert' } });
    }
  }
}
