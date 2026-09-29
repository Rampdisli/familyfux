import { Injectable, computed, inject, resource } from '@angular/core';
import { Auth } from '../../core/auth';
import { supabase } from '../../core/supabase-client';
import { PoolColor, TaskPool } from '../tasks/task-pool';

export type RewardCategory = 'screen' | 'food' | 'fun';

export const REWARD_CATEGORIES: readonly RewardCategory[] = ['screen', 'food', 'fun'];

export const CATEGORY_LABELS: Record<RewardCategory, string> = {
  screen: 'Bildschirm',
  food: 'Essen',
  fun: 'Erlebnisse',
};

/** Symbols offered when creating / editing a reward. */
export const REWARD_ICONS = ['📱', '🎮', '📺', '🎧', '🍨', '🍕', '🧁', '🍿', '🌙', '🎬', '🏞️', '🎲', '🎨', '⚽', '🏊', '🎁'];

/** Limits of the rewards table (supabase/migrations/20260929150000_rewards.sql). */
export const MAX_PRICE = 999;
export const MAX_UNIT_AMOUNT = 999;
export const MAX_QUANTITY = 10;
export const MAX_TITLE_LENGTH = 40;
export const MAX_DESCRIPTION_LENGTH = 40;
export const MAX_UNIT_LABEL_LENGTH = 20;

/** A row of `rewards`. */
export interface Reward {
  id: string;
  title: string;
  emoji: string;
  color: PoolColor;
  category: RewardCategory;
  /** Stars per unit ("In Einheiten") or per purchase ("Pro Kauf"). */
  price: number;
  /** Set = "In Einheiten" (e.g. 5 Minuten), null = "Pro Kauf". */
  unit_amount: number | null;
  unit_label: string | null;
  description: string | null;
  max_quantity: number;
  is_active: boolean;
}

/** What "Neue Belohnung" / "Belohnungen verwalten" save into `rewards`. */
export type RewardInput = Omit<Reward, 'id' | 'is_active'>;

/** A row of `reward_purchases`: title, emoji, colour and cost are copies from the time of the purchase. */
export interface Purchase {
  id: string;
  member_id: string | null;
  reward_id: string | null;
  title: string;
  emoji: string;
  color: PoolColor;
  quantity: number;
  /** "Tabletzeit · 15 Minuten", or just the title. */
  label: string;
  cost: number;
  purchased_at: string;
  redeemed_at: string | null;
  redeemed_by: string | null;
}

export const PURCHASE_COLUMNS =
  'id, member_id, reward_id, title, emoji, color, quantity, label, cost, purchased_at, redeemed_at, redeemed_by';

const REWARD_COLUMNS = 'id, title, emoji, color, category, price, unit_amount, unit_label, description, max_quantity, is_active';

type Unit = Pick<Reward, 'unit_amount' | 'unit_label'>;

/** "Folge" → "Folgen" for more than one; "Minuten" stays. */
export function pluralUnit(label: string, count: number): string {
  return count === 1 ? label : /e$/.test(label) ? `${label}n` : label;
}

/** "15 Minuten" for `quantity` units of a reward "In Einheiten". */
export function amountText(reward: Unit, quantity: number): string {
  const total = (reward.unit_amount ?? 0) * quantity;
  return `${total} ${pluralUnit(reward.unit_label ?? '', total)}`;
}

/** Second line of a shop card: "5 Minuten", or the description ("beim Abendessen"). */
export function unitText(reward: Unit & Pick<Reward, 'description'>): string {
  return reward.unit_amount ? amountText(reward, 1) : (reward.description ?? '');
}

/** "15 Minuten Tabletzeit" / "Dessert aussuchen" — what was bought, for the "Gekauft!" view. */
export function boughtText(reward: Unit & Pick<Reward, 'title'>, quantity: number): string {
  return reward.unit_amount ? `${amountText(reward, quantity)} ${reward.title}` : reward.title;
}

/** Live summary below the reward form, e.g. "Im Shop: 20 ⭐ für 5 Minuten · bis 6× pro Kauf = 30 Minuten für 120 ⭐." */
export function rewardSummary(reward: Unit & Pick<Reward, 'title' | 'price' | 'max_quantity'>): string {
  const title = reward.title.trim() || 'Neue Belohnung';
  if (reward.unit_amount === null) {
    return `Im Shop: „${title}“ für ${reward.price} ⭐, einmal pro Kauf.`;
  }
  if (!(reward.unit_amount >= 1) || !reward.unit_label?.trim()) {
    return 'Menge und Einheit ausfüllen.';
  }
  const unit = { unit_amount: reward.unit_amount, unit_label: reward.unit_label.trim() };
  const max = reward.max_quantity;
  return (
    `Im Shop: ${reward.price} ⭐ für ${amountText(unit, 1)}` +
    (max > 1 ? ` · bis ${max}× pro Kauf = ${amountText(unit, max)} für ${reward.price * max} ⭐` : '') +
    '.'
  );
}

/**
 * The family's rewards and the purchases nobody ticked off yet.
 * Balances live in TaskPool (member_balance), next to the stars they come from.
 */
@Injectable({ providedIn: 'root' })
export class Rewards {
  private readonly auth = inject(Auth);
  private readonly pool = inject(TaskPool);

  readonly data = resource({
    params: () => ({ userId: this.auth.user()?.id }),
    loader: async ({ params }) => {
      if (!params.userId) {
        return null;
      }

      const [rewards, open] = await Promise.all([
        supabase.from('rewards').select(REWARD_COLUMNS).order('sort_order').order('price').order('title'),
        supabase
          .from('reward_purchases')
          .select(PURCHASE_COLUMNS)
          .is('redeemed_at', null)
          .order('purchased_at', { ascending: false }),
      ]);

      const error = rewards.error ?? open.error;
      if (error) {
        throw new Error(error.message, { cause: error });
      }

      return { rewards: rewards.data as Reward[], open: open.data as Purchase[] };
    },
  });

  /** All rewards, archived ones included. */
  readonly all = computed(() => this.data.value()?.rewards ?? []);
  /** What's in the shop. */
  readonly active = computed(() => this.all().filter((r) => r.is_active));
  /** Bought, not redeemed yet — the whole family, newest first. */
  readonly open = computed(() => this.data.value()?.open ?? []);

  reward(id: string | null | undefined): Reward | undefined {
    return this.all().find((r) => r.id === id);
  }

  /** Buys `quantity` units for a kid; the server checks the balance. Resolves to an error message, if any. */
  async redeem(memberId: string, rewardId: string, quantity: number): Promise<string | null> {
    const { error } = await supabase.rpc('redeem_reward', {
      p_member_id: memberId,
      p_reward_id: rewardId,
      p_quantity: quantity,
    });
    this.reloadAll();
    return error?.message ?? null;
  }

  /** Parents: the kid got it. */
  async confirm(purchaseId: string): Promise<string | null> {
    const { data, error } = await supabase.rpc('confirm_redemption', { p_purchase_id: purchaseId });
    this.reloadAll();
    return error?.message ?? (data ? null : 'Schon abgehakt, oder du darfst das nicht.');
  }

  /** Parents: takes a purchase back that wasn't redeemed yet; the stars come back. */
  async cancel(purchaseId: string): Promise<string | null> {
    const { data, error } = await supabase.rpc('cancel_purchase', { p_purchase_id: purchaseId });
    this.reloadAll();
    return error?.message ?? (data ? null : 'Schon eingelöst, oder du darfst das nicht.');
  }

  createReward(input: RewardInput): Promise<string | null> {
    const familyId = this.pool.me()?.family_id;
    if (!familyId) {
      return Promise.resolve('Du gehörst zu keiner Familie.');
    }
    return this.mutate(
      supabase.from('rewards').insert({ ...input, family_id: familyId, sort_order: this.all().length }),
    );
  }

  updateReward(id: string, input: RewardInput): Promise<string | null> {
    return this.mutate(supabase.from('rewards').update(input).eq('id', id));
  }

  /** Archived rewards leave the shop; their purchases stay. */
  setArchived(id: string, archived: boolean): Promise<string | null> {
    return this.mutate(supabase.from('rewards').update({ is_active: !archived }).eq('id', id));
  }

  private async mutate(query: PromiseLike<{ error: { message: string; code?: string } | null }>): Promise<string | null> {
    const { error } = await query;
    this.data.reload();
    if (error?.code === '23505') {
      return 'Es gibt schon eine aktive Belohnung mit diesem Namen.';
    }
    return error?.message ?? null;
  }

  /** Purchases change balances too. */
  private reloadAll(): void {
    this.data.reload();
    this.pool.data.reload();
  }
}
