import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { RewardCard } from '../reward-card/reward-card';
import { RewardForm, previewReward, rewardDraft } from '../reward-form/reward-form';
import { RewardInput, Rewards } from '../rewards';

/** "Neue Belohnung" (parents only) — design/prototypes/fuxis-plan-belohnungen.html */
@Component({
  selector: 'app-reward-create',
  imports: [RewardCard, RewardForm, RouterLink],
  templateUrl: './reward-create.html',
  styleUrl: './reward-create.scss',
})
export class RewardCreate {
  private readonly rewards = inject(Rewards);
  private readonly router = inject(Router);

  protected readonly draft = signal(rewardDraft());
  protected readonly preview = computed(() => previewReward(this.draft()));
  protected readonly saving = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  protected async save(input: RewardInput): Promise<void> {
    this.saving.set(true);
    this.errorMessage.set(null);
    const error = await this.rewards.createReward(input);
    this.saving.set(false);

    if (error) {
      this.errorMessage.set(error);
    } else {
      void this.router.navigateByUrl('/belohnungen/verwalten');
    }
  }

  protected cancel(): void {
    void this.router.navigateByUrl('/belohnungen/verwalten');
  }
}
