import { Component, ElementRef, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TaskPool, formatStars, possessive } from '../../tasks/task-pool';
import { FuxiHero } from '../fuxi-hero';
import { RewardCard } from '../reward-card/reward-card';
import { CATEGORY_LABELS, REWARD_CATEGORIES, Reward, RewardCategory, Rewards, amountText, boughtText, unitText } from '../rewards';

type CategoryFilter = RewardCategory | 'all';

/** What was just bought, for the "Gekauft!" view. */
interface Bought {
  text: string;
  balance: number;
}

/**
 * "Belohnungen" — design/prototypes/fuxis-plan-belohnungen.html
 *
 * The shop of the kid picked in the brown bar: kids buy for themselves,
 * parents for the picked kid (shared device). With "Alle" or a parent picked
 * the cards are only for looking.
 */
@Component({
  selector: 'app-reward-shop',
  imports: [FuxiHero, RewardCard, RouterLink],
  templateUrl: './reward-shop.html',
  styleUrl: './reward-shop.scss',
  host: {
    '(document:keydown.escape)': 'close()',
  },
})
export class RewardShop {
  protected readonly pool = inject(TaskPool);
  protected readonly rewards = inject(Rewards);

  protected readonly categories: { key: CategoryFilter; label: string }[] = [
    { key: 'all', label: 'Alle' },
    ...REWARD_CATEGORIES.map((key) => ({ key, label: CATEGORY_LABELS[key] })),
  ];

  protected readonly category = signal<CategoryFilter>('all');
  /** Reward whose dialog is open. */
  protected readonly selectedId = signal<string | null>(null);
  protected readonly quantity = signal(1);
  protected readonly buying = signal(false);
  protected readonly bought = signal<Bought | null>(null);
  protected readonly errorMessage = signal<string | null>(null);

  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');

  /** The kid who's shopping; null with "Alle" or a parent picked. */
  protected readonly kid = computed(() => {
    const member = this.pool.selectedMember();
    return member?.role === 'child' ? member : null;
  });

  private readonly kidId = computed(() => this.kid()?.id ?? null);

  protected readonly balance = computed(() => this.pool.balance(this.kidId()));

  protected readonly visible = computed(() => {
    const category = this.category();
    return this.rewards.active().filter((r) => category === 'all' || r.category === category);
  });

  /** Cheapest reward the kid can't afford yet, for Fuxi's "Noch 65 ⭐ bis …". */
  protected readonly next = computed(() =>
    this.rewards
      .active()
      .filter((r) => r.price > this.balance())
      .reduce<Reward | null>((best, r) => (!best || r.price < best.price ? r : best), null),
  );

  protected readonly selected = computed(() => this.rewards.reward(this.selectedId()));
  protected readonly cost = computed(() => (this.selected()?.price ?? 0) * this.quantity());
  protected readonly rest = computed(() => this.balance() - this.cost());

  constructor() {
    // Focus the dialog when it opens (Escape / Tab start there).
    effect(() => {
      this.dialog()?.nativeElement.focus();
    });

    // Picking someone else in the brown bar closes the dialog (reloads after a purchase don't).
    effect(() => {
      this.kidId();
      untracked(() => this.close());
    });
  }

  protected missing(reward: Reward): number {
    return this.kid() ? Math.max(0, reward.price - this.balance()) : 0;
  }

  protected open(reward: Reward): void {
    this.selectedId.set(reward.id);
    this.quantity.set(1);
    this.bought.set(null);
    this.errorMessage.set(null);
  }

  close(): void {
    this.selectedId.set(null);
    this.bought.set(null);
  }

  protected changeQuantity(delta: number): void {
    const max = this.selected()?.max_quantity ?? 1;
    this.quantity.update((q) => Math.min(max, Math.max(1, q + delta)));
  }

  protected async buy(): Promise<void> {
    const kid = this.kid();
    const reward = this.selected();
    if (!kid || !reward || this.rest() < 0 || this.buying()) {
      return;
    }

    this.buying.set(true);
    this.errorMessage.set(null);
    const quantity = this.quantity();
    const balance = this.rest();
    const error = await this.rewards.redeem(kid.id, reward.id, quantity);
    this.buying.set(false);

    if (error) {
      this.errorMessage.set(error);
    } else {
      this.bought.set({ text: boughtText(reward, quantity), balance });
    }
  }

  protected stars(stars: number): string {
    return formatStars(stars);
  }

  protected possessive(name: string): string {
    return possessive(name);
  }

  protected unitText(reward: Reward): string {
    return unitText(reward);
  }

  protected amountText(reward: Reward, quantity: number): string {
    return amountText(reward, quantity);
  }
}
