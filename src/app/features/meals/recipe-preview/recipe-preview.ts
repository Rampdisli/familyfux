import { Component, computed, input } from '@angular/core';
import { IngredientInput, cssImage, recipeSource } from '../meals';

/** The recipe card as it will look in the list — preview of "Rezept importieren" / "Rezept bearbeiten". */
@Component({
  selector: 'app-recipe-preview',
  template: `
    <div class="preview-label">Vorschau</div>
    <div class="preview-card">
      <div class="pc-image" [style.background-image]="background(image())">
        @if (!image()) {
          <span>🍲</span>
        }
        <span class="pc-source">{{ source() }}</span>
      </div>
      <div class="pc-body">
        <div class="pc-title">{{ title().trim() || placeholder() }}</div>
        <div class="pc-ingredients">
          @for (ingredient of ingredients(); track $index) {
            <span class="ing-chip">
              @if (ingredient.quantity) {
                <b>{{ ingredient.quantity }}</b>
              }
              {{ ingredient.name }}
            </span>
          } @empty {
            <span class="pc-empty">Noch keine Zutaten</span>
          }
        </div>
      </div>
    </div>
  `,
  styleUrl: './recipe-preview.scss',
})
export class RecipePreview {
  readonly title = input.required<string>();
  /** Web link or null. */
  readonly url = input<string | null>(null);
  readonly image = input<string | null>(null);
  readonly ingredients = input.required<IngredientInput[]>();
  /** Shown while the name is empty. */
  readonly placeholder = input('Neues Rezept');

  protected readonly background = cssImage;
  protected readonly source = computed(() => recipeSource(this.url()));
}
