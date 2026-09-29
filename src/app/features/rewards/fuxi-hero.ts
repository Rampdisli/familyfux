import { Component, booleanAttribute, input } from '@angular/core';

/**
 * Fuxi's banner on "Belohnungen" and "Profil": orange with a kid picked,
 * brown ("muted") when the page needs someone picked in the brown bar first.
 */
@Component({
  selector: 'app-fuxi-hero',
  template: `
    <div class="fuxi" aria-hidden="true">🦊</div>
    <div>
      <div class="big"><ng-content select="[big]" /></div>
      <div class="say"><ng-content select="[say]" /></div>
    </div>
  `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      gap: 18px;
      padding: 18px 22px;
      border-radius: 24px;
      background: linear-gradient(135deg, var(--amber), var(--orange));
      color: #fff;
      box-shadow: 0 16px 30px -16px rgba(232, 112, 60, 0.7);
    }

    :host(.muted) {
      background: linear-gradient(135deg, var(--brown-soft), var(--brown));
      box-shadow: 0 16px 30px -16px rgba(90, 52, 35, 0.6);

      .big {
        font-size: 24px;
      }
    }

    .fuxi {
      width: 64px;
      height: 64px;
      flex-shrink: 0;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.25);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 34px;
    }

    .big {
      font-family: var(--font-display);
      font-weight: 600;
      font-size: 34px;
      line-height: 1.05;
    }

    .say {
      margin-top: 4px;
      font-size: 14px;
      font-weight: 600;
      opacity: 0.95;
    }

    @media (max-width: 640px) {
      :host {
        padding: 16px;
      }

      .fuxi {
        width: 52px;
        height: 52px;
        font-size: 28px;
      }

      .big {
        font-size: 26px;
      }
    }
  `,
  host: {
    '[class.muted]': 'muted()',
  },
})
export class FuxiHero {
  readonly muted = input(false, { transform: booleanAttribute });
}
