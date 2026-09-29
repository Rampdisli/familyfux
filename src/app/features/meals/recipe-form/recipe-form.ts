import { Component, ElementRef, afterNextRender, booleanAttribute, computed, inject, input, model, output, Injector } from '@angular/core';
import { RouterLink } from '@angular/router';
import { cssImage } from '../meals';
import { DraftRow, RecipeDraft, deviationSummary, emptyRow, rowStatus, webUrl } from './recipe-draft';

/**
 * The recipe form of "Rezept importieren" (/essen/neu) and "Rezept bearbeiten"
 * (design/prototypes/fuxis-plan-rezept-bearbeiten.html). The draft is two-way
 * bound, so the page can show a live preview.
 *
 * Editing shows each ingredient's deviation from the original recipe: × on a
 * row from the original leaves it out (the original stays), on an added row
 * removes it.
 */
@Component({
  selector: 'app-recipe-form',
  imports: [RouterLink],
  templateUrl: './recipe-form.html',
  styleUrl: './recipe-form.scss',
})
export class RecipeForm {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  readonly draft = model.required<RecipeDraft>();
  /** "Rezept bearbeiten": picture thumbnail, deviations, "Ungespeicherte Änderungen". */
  readonly editing = input(false, { transform: booleanAttribute });
  /** Something differs from what's saved (editing only; a new recipe can always be saved). */
  readonly changed = input(true);
  readonly saving = input(false);
  readonly errorMessage = input<string | null>(null);
  readonly submitLabel = input('Rezept speichern');
  /** Where "Abbrechen" leads. */
  readonly cancelLink = input.required<string | unknown[]>();

  readonly save = output<void>();

  protected readonly background = cssImage;
  protected readonly status = rowStatus;

  protected readonly titleMissing = computed(() => this.draft().title.trim() === '');
  protected readonly image = computed(() => webUrl(this.draft().imageUrl));
  protected readonly urlInvalid = computed(() => this.draft().url.trim() !== '' && !webUrl(this.draft().url));
  protected readonly imageInvalid = computed(() => this.draft().imageUrl.trim() !== '' && !this.image());
  protected readonly summary = computed(() => deviationSummary(this.draft().rows));

  protected readonly canSave = computed(
    () => !this.titleMissing() && !this.urlInvalid() && !this.imageInvalid() && this.changed() && !this.saving(),
  );

  protected patch(changes: Partial<RecipeDraft>): void {
    this.draft.update((d) => ({ ...d, ...changes }));
  }

  private updateRows(update: (rows: DraftRow[]) => DraftRow[]): void {
    this.draft.update((d) => ({ ...d, rows: update(d.rows) }));
  }

  protected setRow(index: number, field: 'quantity' | 'name', value: string): void {
    this.updateRows((rows) => rows.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
  }

  /** "+ Zutat" / Enter in "Zutat": a new, empty (added) row; editing puts the focus into its "Menge". */
  protected addRow(): void {
    this.updateRows((rows) => [...rows, emptyRow()]);
    if (this.editing()) {
      afterNextRender(
        () => {
          const inputs = this.host.nativeElement.querySelectorAll<HTMLInputElement>('.ing-qty-input');
          inputs[inputs.length - 1]?.focus();
        },
        { injector: this.injector },
      );
    }
  }

  /**
   * ×: a row from the original is left out (the original stays), an added one removed.
   * A new recipe always keeps one row to type into.
   */
  protected removeRow(index: number): void {
    this.updateRows((rows) => {
      const row = rows[index];
      if (row.originalName !== null) {
        return rows.map((r, i) => (i === index ? { ...r, name: null, quantity: '' } : r));
      }
      const rest = rows.filter((_, i) => i !== index);
      return rest.length || this.editing() ? rest : [emptyRow()];
    });
  }

  /** "↺ wie im Original" / "↺ zurückholen". */
  protected resetRow(index: number): void {
    this.updateRows((rows) =>
      rows.map((r, i) => (i === index ? { ...r, name: r.originalName, quantity: r.originalQuantity ?? '' } : r)),
    );
  }

  protected original(row: DraftRow): string {
    return [row.originalQuantity, row.originalName].filter(Boolean).join(' ');
  }

  protected submit(): void {
    if (this.canSave()) {
      this.save.emit();
    }
  }
}
