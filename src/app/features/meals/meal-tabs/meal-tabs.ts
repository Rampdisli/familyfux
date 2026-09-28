import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { filter, map } from 'rxjs';

/** "🍽️ Rezepte | 📅 Wochenplan" — the sub-navigation of "Essen". */
@Component({
  selector: 'app-meal-tabs',
  imports: [RouterLink, RouterLinkActive],
  template: `
    <nav class="subnav" aria-label="Essen">
      <a routerLink="/essen" [class.active]="recipesActive()" [attr.aria-current]="recipesActive() ? 'page' : null">
        🍽️ Rezepte
      </a>
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
export class MealTabs {
  private readonly router = inject(Router);

  private readonly path = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => this.router.url.split(/[?#]/)[0]),
    ),
    { initialValue: this.router.url.split(/[?#]/)[0] },
  );

  /** "Rezepte" stays active with a recipe's details open (/essen/rezept/…), but not on the week plan. */
  protected readonly recipesActive = computed(() => this.path() === '/essen' || this.path().startsWith('/essen/rezept/'));
}
