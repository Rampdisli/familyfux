import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Meals, cssImage, recipeSource } from '../meals';

/** Only web links; anything else would end up in an href / background-image. */
function webUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const url = new URL(trimmed);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

/** "Rezept importieren": a Fooby / Cookidoo link or an own recipe, typed in by hand. */
@Component({
  selector: 'app-recipe-create',
  imports: [RouterLink],
  templateUrl: './recipe-create.html',
  styleUrl: './recipe-create.scss',
})
export class RecipeCreate {
  private readonly meals = inject(Meals);
  private readonly router = inject(Router);

  protected readonly background = cssImage;

  protected readonly title = signal('');
  protected readonly url = signal('');
  protected readonly imageUrl = signal('');
  /** One ingredient per line (commas work too). */
  protected readonly ingredientsText = signal('');
  protected readonly available = signal(true);

  protected readonly saving = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  protected readonly ingredients = computed(() =>
    this.ingredientsText()
      .split(/[\n,]/)
      .map((i) => i.trim())
      .filter(Boolean),
  );

  protected readonly link = computed(() => webUrl(this.url()));
  protected readonly image = computed(() => webUrl(this.imageUrl()));
  protected readonly source = computed(() => recipeSource(this.link()));

  protected readonly urlInvalid = computed(() => this.url().trim() !== '' && !this.link());
  protected readonly imageInvalid = computed(() => this.imageUrl().trim() !== '' && !this.image());

  protected readonly canSave = computed(
    () => this.title().trim().length > 0 && !this.urlInvalid() && !this.imageInvalid() && !this.saving(),
  );

  protected async save(): Promise<void> {
    if (!this.canSave()) {
      return;
    }

    this.saving.set(true);
    this.errorMessage.set(null);

    const error = await this.meals.createRecipe({
      title: this.title().trim(),
      url: this.link(),
      image_url: this.image(),
      ingredients: this.ingredients(),
      ingredients_available: this.available(),
    });

    this.saving.set(false);

    if (error) {
      this.errorMessage.set(error);
    } else {
      void this.router.navigateByUrl('/essen');
    }
  }
}
