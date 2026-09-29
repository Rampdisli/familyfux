import {
  Component,
  ElementRef,
  OnDestroy,
  afterRenderEffect,
  computed,
  inject,
  input,
  output,
  resource,
  signal,
  viewChild,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { supabase } from '../../../core/supabase-client';
import { MealSlot, Meals, Recipe, cssImage, recipeSource, storedImagePath } from '../meals';

const WEEKDAYS_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const SLOT_LABELS: Record<MealSlot, string> = { lunch: 'Mittag', dinner: 'Abend' };

const FOCUSABLE = 'a[href], button:not([disabled])';

/** Today (yyyy-mm-dd) in the family's time zone. */
function todayIn(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(),
  );
}

/**
 * "Rezept löschen" (parents only) — design/prototypes/fuxis-plan-rezept-bearbeiten.html, screen 3.
 * Checks the meal plan afresh when it opens: with any meal (planned or cooked)
 * it explains why the recipe stays, otherwise it deletes it for good.
 * Phones: bottom sheet; from 768 px centred.
 */
@Component({
  selector: 'app-recipe-delete-dialog',
  imports: [RouterLink],
  templateUrl: './recipe-delete-dialog.html',
  styleUrl: './recipe-delete-dialog.scss',
})
export class RecipeDeleteDialog implements OnDestroy {
  private readonly meals = inject(Meals);
  private readonly router = inject(Router);

  readonly recipe = input.required<Recipe>();
  /** Esc, the scrim, "Schliessen" / "Abbrechen". */
  readonly close = output<void>();

  private readonly sheet = viewChild<ElementRef<HTMLElement>>('sheet');
  private readonly secondButton = viewChild<ElementRef<HTMLElement>>('second');

  protected readonly background = cssImage;

  protected readonly deleting = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  /** The recipe's meals and who rated / wished for it — loaded when the dialog opens (and again after a refused delete). */
  protected readonly check = resource({
    params: () => ({ id: this.recipe().id }),
    loader: async ({ params }) => {
      const [family, meals, ratings, wishes] = await Promise.all([
        supabase.from('families').select('timezone').limit(1).maybeSingle(),
        supabase.from('meals').select('day, meal').eq('recipe_id', params.id).order('day'),
        supabase.from('recipe_ratings').select('member_id').eq('recipe_id', params.id),
        supabase.from('recipe_wishes').select('member_id').eq('recipe_id', params.id),
      ]);

      const error = family.error ?? meals.error ?? ratings.error ?? wishes.error;
      if (error) {
        throw new Error(error.message, { cause: error });
      }

      const today = todayIn((family.data?.timezone as string | undefined) ?? 'Europe/Zurich');
      const all = (meals.data ?? []) as { day: string; meal: MealSlot }[];
      const people = new Set([...(ratings.data ?? []), ...(wishes.data ?? [])].map((r) => r.member_id as string));
      return {
        // From today on counts as planned, before today as cooked (as in the recipe details).
        planned: all
          .filter((m) => m.day >= today)
          .sort((a, b) => a.day.localeCompare(b.day) || (a.meal === 'lunch' ? -1 : 1)),
        cooked: all.filter((m) => m.day < today).length,
        people: people.size,
      };
    },
  });

  protected readonly blocked = computed(() => {
    const check = this.check.value();
    return !!check && (check.planned.length > 0 || check.cooked > 0);
  });

  /** "Do Mittag, Sa Abend" */
  protected readonly plannedDays = computed(() =>
    (this.check.value()?.planned ?? [])
      .map((m) => {
        const [y, mo, d] = m.day.split('-').map(Number);
        return `${WEEKDAYS_SHORT[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()]} ${SLOT_LABELS[m.meal]}`;
      })
      .join(', '),
  );

  protected readonly storedPhoto = computed(() => !!storedImagePath(this.recipe().image_url));
  protected readonly source = computed(() => recipeSource(this.recipe().url));

  private readonly previousOverflow = document.body.style.overflow;
  private readonly opener = document.activeElement as HTMLElement | null;

  constructor() {
    // The page underneath doesn't scroll while the dialog is open.
    document.body.style.overflow = 'hidden';

    // Focus starts on the second button ("Schliessen" / "Abbrechen") once the variant is known.
    afterRenderEffect(() => {
      this.blocked();
      this.check.hasValue();
      this.secondButton()?.nativeElement.focus({ preventScroll: true });
    });
  }

  ngOnDestroy(): void {
    document.body.style.overflow = this.previousOverflow;
    if (this.opener?.isConnected) {
      this.opener.focus({ preventScroll: true });
    }
  }

  protected onEscape(event: Event): void {
    // Only this dialog: the recipe details underneath listen to Esc as well.
    event.stopPropagation();
    this.close.emit();
  }

  protected onBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.close.emit();
    }
  }

  /** Keeps Tab inside the dialog. */
  protected trapFocus(event: KeyboardEvent): void {
    if (event.key !== 'Tab') {
      return;
    }
    const focusable = Array.from(this.sheet()?.nativeElement.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    if (!focusable.length) {
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  /** "Endgültig löschen": no way back. A meal added meanwhile makes the database refuse; then the check runs again. */
  protected async delete(): Promise<void> {
    const recipe = this.recipe();
    this.deleting.set(true);
    this.errorMessage.set(null);
    const error = await this.meals.deleteRecipe(recipe);
    this.deleting.set(false);

    if (error) {
      this.errorMessage.set(error);
      this.check.reload();
    } else {
      void this.router.navigate(['/essen'], { state: { toast: `🗑️ „${recipe.title}“ gelöscht` } });
    }
  }
}
