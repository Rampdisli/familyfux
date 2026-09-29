import { Component, computed, input } from '@angular/core';
import { Reward, unitText } from '../rewards';

/**
 * A reward as it looks in the shop: tile, name, unit / description and price.
 * Used on a <button> in the shop and on a <div> as the form's preview.
 */
@Component({
  selector: '[app-reward-card]',
  template: `
    <div class="r-icon tile-{{ reward().color }}">{{ reward().emoji }}</div>
    <div>
      <div class="r-name">{{ reward().title }}</div>
      <div class="r-unit">{{ unit() }}</div>
    </div>
    <span class="price">{{ reward().price }} ⭐</span>
    @if (missing(); as stars) {
      <span class="missing">noch {{ stars }} ⭐</span>
    }
  `,
  styleUrl: './reward-card.scss',
  host: {
    class: 'reward-card',
    '[class.short]': 'missing() > 0',
  },
})
export class RewardCard {
  readonly reward = input.required<Pick<Reward, 'title' | 'emoji' | 'color' | 'price' | 'unit_amount' | 'unit_label' | 'description'>>();
  /** Stars still missing to afford it; dims the card. */
  readonly missing = input(0);

  protected readonly unit = computed(() => unitText(this.reward()));
}
