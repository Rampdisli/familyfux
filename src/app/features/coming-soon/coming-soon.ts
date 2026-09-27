import { Component, input } from '@angular/core';

/** Placeholder for navigation areas that aren't built yet (icon/title/text come from the route data). */
@Component({
  selector: 'app-coming-soon',
  template: `
    <div class="panel">
      <div class="p-icon">{{ icon() }}</div>
      <h1>{{ title() }}</h1>
      <p>{{ text() }}</p>
    </div>
  `,
  styles: `
    :host {
      display: block;
      max-width: 1240px;
      margin: 0 auto;
      padding: 0 34px 40px;
    }

    .panel {
      background: #fff;
      border-radius: 26px;
      min-height: 420px;
      padding: 40px;
      box-shadow: 0 16px 32px -18px var(--shadow-warm);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      gap: 14px;
    }

    .p-icon {
      width: 72px;
      height: 72px;
      border-radius: 50%;
      background: var(--cream);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 34px;
    }

    h1 {
      margin: 0;
      font-family: var(--font-display);
      font-weight: 600;
      font-size: 22px;
    }

    p {
      margin: 0;
      color: var(--brown-soft);
      font-size: 14px;
      max-width: 340px;
    }

    @media (max-width: 640px) {
      :host {
        padding-inline: 18px;
      }
    }
  `,
})
export class ComingSoon {
  readonly icon = input('');
  readonly title = input('');
  readonly text = input('');
}
