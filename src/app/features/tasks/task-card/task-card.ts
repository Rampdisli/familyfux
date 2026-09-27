import { Component, computed, inject, input, signal } from '@angular/core';
import { PoolClaim, PoolTask, TaskPool, formatStars } from '../task-pool';

/**
 * One entry of the pool. Several members can take it on together; everybody
 * ticks off their own part, and the entry is done once all of them are.
 */
@Component({
  selector: 'app-task-card',
  templateUrl: './task-card.html',
  styleUrl: './task-card.scss',
  host: {
    '[class.claimed]': 'task().claims.length > 0',
    '[class.completed]': 'task().is_done',
  },
})
export class TaskCard {
  protected readonly pool = inject(TaskPool);

  readonly task = input.required<PoolTask>();

  protected readonly pickerOpen = signal(false);

  protected readonly participants = computed(() =>
    this.task().claims.map((claim) => ({ claim, member: this.pool.member(claim.member_id) })),
  );

  /** Members who haven't joined yet (offered in the picker). */
  protected readonly available = computed(() => {
    const joined = new Set(this.task().claims.map((c) => c.member_id));
    return this.pool.family().filter((m) => !joined.has(m.id));
  });

  /** "+3 ⭐ für jeden" or "3 ⭐ zum Teilen · je 1,5". */
  protected readonly rewardLabel = computed(() => {
    const { reward, reward_mode, claims } = this.task();
    if (reward_mode === 'each') {
      return `+${reward} ⭐ für jeden`;
    }
    return claims.length > 1
      ? `${reward} ⭐ zum Teilen · je ${formatStars(reward / claims.length)}`
      : `${reward} ⭐ zum Teilen`;
  });

  protected join(memberId: string): void {
    this.pickerOpen.set(false);
    void this.pool.join(this.task().id, memberId);
  }

  protected leave(claim: PoolClaim): void {
    void this.pool.leave(claim);
  }

  protected toggleDone(claim: PoolClaim): void {
    void this.pool.toggleDone(claim);
  }
}
