import { Component, booleanAttribute, computed, input, model, output } from '@angular/core';
import { POOL_COLORS, PoolColor } from '../../tasks/task-pool';
import {
  CATEGORY_LABELS,
  MAX_DESCRIPTION_LENGTH,
  MAX_PRICE,
  MAX_QUANTITY,
  MAX_TITLE_LENGTH,
  MAX_UNIT_AMOUNT,
  MAX_UNIT_LABEL_LENGTH,
  REWARD_CATEGORIES,
  REWARD_ICONS,
  Reward,
  RewardCategory,
  RewardInput,
  rewardSummary,
} from '../rewards';

/** Unsaved values of the reward form; unit fields are kept while "Pro Kauf" is picked, in case it's switched back. */
export interface RewardDraft {
  title: string;
  emoji: string;
  color: PoolColor;
  category: RewardCategory;
  price: number;
  mode: 'single' | 'units';
  unit_amount: number;
  unit_label: string;
  description: string;
  max_quantity: number;
}

export function rewardDraft(reward?: Reward): RewardDraft {
  if (!reward) {
    return {
      title: '',
      emoji: '🎁',
      color: 'peach',
      category: 'fun',
      price: 20,
      mode: 'single',
      unit_amount: 5,
      unit_label: 'Minuten',
      description: '',
      max_quantity: 6,
    };
  }
  return {
    title: reward.title,
    emoji: reward.emoji,
    color: reward.color,
    category: reward.category,
    price: reward.price,
    mode: reward.unit_amount ? 'units' : 'single',
    unit_amount: reward.unit_amount ?? 5,
    unit_label: reward.unit_label ?? 'Minuten',
    description: reward.description ?? '',
    max_quantity: reward.unit_amount ? reward.max_quantity : 6,
  };
}

/** What gets saved: unit fields only "In Einheiten", the description only "Pro Kauf". */
export function rewardInput(draft: RewardDraft): RewardInput {
  const units = draft.mode === 'units';
  return {
    title: draft.title.trim(),
    emoji: draft.emoji,
    color: draft.color,
    category: draft.category,
    price: draft.price,
    unit_amount: units ? draft.unit_amount : null,
    unit_label: units ? draft.unit_label.trim() : null,
    description: units ? null : draft.description.trim() || null,
    max_quantity: units ? draft.max_quantity : 1,
  };
}

export function rewardDraftValid(draft: RewardDraft): boolean {
  const input = rewardInput(draft);
  const whole = (n: number, max: number) => Number.isInteger(n) && n >= 1 && n <= max;
  return (
    input.title.length >= 1 &&
    input.title.length <= MAX_TITLE_LENGTH &&
    whole(input.price, MAX_PRICE) &&
    (draft.mode === 'single' || (whole(draft.unit_amount, MAX_UNIT_AMOUNT) && !!input.unit_label))
  );
}

/** How the reward looks in the shop while it's being edited (name placeholder when empty). */
export function previewReward(draft: RewardDraft): RewardInput {
  const input = rewardInput(draft);
  return { ...input, title: input.title || 'Neue Belohnung' };
}

/** Whole number within min…max; junk → `fallback`. */
function clampInt(value: string, min: number, max: number, fallback: number): number {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

/**
 * The reward form of "Neue Belohnung" and "Belohnungen verwalten" (inline) —
 * design/prototypes/fuxis-plan-belohnungen.html. The draft is two-way bound,
 * so the page can show a live preview.
 */
@Component({
  selector: 'app-reward-form',
  templateUrl: './reward-form.html',
  styleUrl: './reward-form.scss',
})
export class RewardForm {
  readonly draft = model.required<RewardDraft>();
  /** Editing an existing reward: "Speichern" and the note about prices. */
  readonly editing = input(false, { transform: booleanAttribute });
  readonly saving = input(false);
  readonly errorMessage = input<string | null>(null);

  readonly save = output<RewardInput>();
  readonly cancel = output<void>();

  protected readonly colors = POOL_COLORS;
  protected readonly categories = REWARD_CATEGORIES;
  protected readonly categoryLabels = CATEGORY_LABELS;
  protected readonly maxPrice = MAX_PRICE;
  protected readonly maxQuantity = MAX_QUANTITY;
  protected readonly maxUnitAmount = MAX_UNIT_AMOUNT;
  protected readonly maxTitle = MAX_TITLE_LENGTH;
  protected readonly maxDescription = MAX_DESCRIPTION_LENGTH;
  protected readonly maxUnitLabel = MAX_UNIT_LABEL_LENGTH;

  /** Symbols to pick from; keeps a reward's own symbol selectable even if it's not in the default set. */
  protected readonly icons = computed(() => {
    const current = this.draft().emoji;
    return REWARD_ICONS.includes(current) ? REWARD_ICONS : [current, ...REWARD_ICONS];
  });

  protected readonly valid = computed(() => rewardDraftValid(this.draft()));
  protected readonly summary = computed(() => rewardSummary(rewardInput(this.draft())));

  protected patch(changes: Partial<RewardDraft>): void {
    this.draft.update((draft) => ({ ...draft, ...changes }));
  }

  protected setMode(mode: RewardDraft['mode']): void {
    this.patch(mode === 'units' && this.draft().max_quantity < 2 ? { mode, max_quantity: 6 } : { mode });
  }

  /** −/+ change the price in steps of 5. */
  protected stepPrice(delta: number): void {
    this.patch({ price: Math.min(MAX_PRICE, Math.max(1, this.draft().price + delta)) });
  }

  /** Typed price, clamped and written back (so "1500" visibly becomes "999"). */
  protected typePrice(input: HTMLInputElement): void {
    const price = clampInt(input.value, 1, MAX_PRICE, this.draft().price);
    input.value = String(price);
    this.patch({ price });
  }

  protected typeAmount(input: HTMLInputElement): void {
    const unit_amount = clampInt(input.value, 1, MAX_UNIT_AMOUNT, this.draft().unit_amount);
    input.value = String(unit_amount);
    this.patch({ unit_amount });
  }

  protected stepMax(delta: number): void {
    this.patch({ max_quantity: Math.min(MAX_QUANTITY, Math.max(1, this.draft().max_quantity + delta)) });
  }

  protected submit(): void {
    if (this.valid() && !this.saving()) {
      this.save.emit(rewardInput(this.draft()));
    }
  }
}
