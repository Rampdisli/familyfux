import { Component, computed, inject, resource, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { supabase } from '../../../core/supabase-client';
import { TaskPool } from '../../tasks/task-pool';
import { RewardDraft, RewardForm, rewardDraft } from '../reward-form/reward-form';
import { CATEGORY_LABELS, PURCHASE_COLUMNS, Purchase, Reward, RewardInput, Rewards, unitText } from '../rewards';

type Filter = 'all' | 'active' | 'archived';

/** How far back "Einlösungen" goes. */
const HISTORY_DAYS = 30;

/**
 * "Belohnungen verwalten" (parents only) — design/prototypes/fuxis-plan-belohnungen.html,
 * built like "Aufgaben verwalten". Archiving takes a reward out of the shop;
 * its purchases stay, and it can be restored.
 */
@Component({
  selector: 'app-reward-admin',
  imports: [RewardForm, RouterLink],
  templateUrl: './reward-admin.html',
  styleUrl: './reward-admin.scss',
})
export class RewardAdmin {
  protected readonly pool = inject(TaskPool);
  protected readonly rewards = inject(Rewards);

  protected readonly categoryLabels = CATEGORY_LABELS;

  protected readonly filter = signal<Filter>('all');
  protected readonly expanded = signal<string | null>(null);
  protected readonly editing = signal<string | null>(null);
  protected readonly archiveArmed = signal<string | null>(null);
  protected readonly draft = signal<RewardDraft>(rewardDraft());
  protected readonly saving = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly editError = signal<string | null>(null);

  /** Purchases of the last 30 days, per reward, newest first. */
  protected readonly purchases = resource({
    // Reloads with the rewards, e.g. after a purchase was ticked off or cancelled.
    params: () => ({ open: this.rewards.open() }),
    loader: async () => {
      const since = new Date();
      since.setDate(since.getDate() - HISTORY_DAYS);
      const { data, error } = await supabase
        .from('reward_purchases')
        .select(PURCHASE_COLUMNS)
        .gte('purchased_at', since.toISOString())
        .order('purchased_at', { ascending: false });
      if (error) {
        throw new Error(error.message, { cause: error });
      }

      const byReward = new Map<string, Purchase[]>();
      for (const p of data as Purchase[]) {
        if (p.reward_id) {
          byReward.set(p.reward_id, [...(byReward.get(p.reward_id) ?? []), p]);
        }
      }
      return byReward;
    },
  });

  protected readonly visible = computed(() => {
    const rewards = this.rewards.all();
    switch (this.filter()) {
      case 'active':
        return rewards.filter((r) => r.is_active);
      case 'archived':
        return rewards.filter((r) => !r.is_active);
      default:
        return rewards;
    }
  });

  protected purchasesOf(reward: Reward): Purchase[] {
    return this.purchases.value()?.get(reward.id) ?? [];
  }

  protected setFilter(filter: Filter): void {
    this.filter.set(filter);
    this.editing.set(null);
    this.archiveArmed.set(null);
  }

  protected toggleHistory(reward: Reward): void {
    this.expanded.update((id) => (id === reward.id ? null : reward.id));
    this.archiveArmed.set(null);
  }

  protected edit(reward: Reward): void {
    this.editing.set(reward.id);
    this.expanded.set(null);
    this.archiveArmed.set(null);
    this.editError.set(null);
    this.draft.set(rewardDraft(reward));
  }

  protected cancelEdit(): void {
    this.editing.set(null);
  }

  protected async save(reward: Reward, input: RewardInput): Promise<void> {
    this.saving.set(true);
    const error = await this.rewards.updateReward(reward.id, input);
    this.saving.set(false);

    this.editError.set(error);
    if (!error) {
      this.editing.set(null);
    }
  }

  /** First click arms the button (✓), the second one archives. */
  protected async archive(reward: Reward): Promise<void> {
    if (this.archiveArmed() !== reward.id) {
      this.archiveArmed.set(reward.id);
      return;
    }

    this.archiveArmed.set(null);
    this.errorMessage.set(await this.rewards.setArchived(reward.id, true));
  }

  protected async restore(reward: Reward): Promise<void> {
    this.errorMessage.set(await this.rewards.setArchived(reward.id, false));
  }

  protected unitText(reward: Reward): string {
    return unitText(reward);
  }

  /** "15 Minuten" of "Tabletzeit · 15 Minuten"; nothing for "Pro Kauf". */
  protected amount(purchase: Purchase): string | null {
    const prefix = `${purchase.title} · `;
    return purchase.label.startsWith(prefix) ? purchase.label.slice(prefix.length) : null;
  }

  protected memberName(id: string | null): string {
    return this.pool.member(id)?.name ?? 'Ehemaliges Mitglied';
  }

  protected memberEmoji(id: string | null): string {
    return this.pool.member(id)?.emoji ?? '❔';
  }

  protected memberColor(id: string | null): string {
    return this.pool.member(id)?.color ?? 'peach';
  }

  /** "Heute, 14:10 Uhr", "Gestern, …", "25.09., …". */
  protected when(iso: string): string {
    const date = new Date(iso);
    const today = new Date();
    const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const diff = Math.round((startOf(today) - startOf(date)) / 86_400_000);
    const day =
      diff === 0 ? 'Heute' : diff === 1 ? 'Gestern' : date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
    return `${day}, ${date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr`;
  }
}
