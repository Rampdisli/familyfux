import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

/** "🍽️ Rezepte | 📅 Wochenplan" — the sub-navigation of "Essen". */
@Component({
  selector: 'app-meal-tabs',
  imports: [RouterLink, RouterLinkActive],
  template: `
    <nav class="subnav" aria-label="Essen">
      <a routerLink="/essen" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">🍽️ Rezepte</a>
      <a routerLink="/essen/wochenplan" routerLinkActive="active">📅 Wochenplan</a>
    </nav>
  `,
  styles: `
    .subnav {
      display: flex;
      width: fit-content;
      gap: 4px;
      background: #fff;
      padding: 5px;
      border-radius: 14px;
      box-shadow: 0 8px 18px var(--shadow-warm);
    }

    a {
      display: flex;
      align-items: center;
      gap: 7px;
      padding: 9px 16px;
      border-radius: 10px;
      font-weight: 600;
      font-size: 13px;
      color: var(--brown-soft);
      text-decoration: none;

      &.active {
        background: var(--orange);
        color: #fff;
      }
    }
  `,
})
export class MealTabs {}
