import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Auth } from './core/auth';
import { Meals } from './features/meals/meals';
import { TaskPool } from './features/tasks/task-pool';

interface NavItem {
  path: string;
  icon: string;
  label: string;
  /** Shorter label for the mobile tab bar. */
  short: string;
}

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly auth = inject(Auth);
  protected readonly pool = inject(TaskPool);
  private readonly meals = inject(Meals);

  protected readonly nav: NavItem[] = [
    { path: '/tasks', icon: '🗂️', label: 'Aufgaben-Pool', short: 'Aufgaben' },
    { path: '/kalender', icon: '📅', label: 'Kalender', short: 'Kalender' },
    { path: '/essen', icon: '🍝', label: 'Essen', short: 'Essen' },
  ];

  /** Badge count per nav item: open tasks, and meals of the coming week nobody has planned yet. */
  protected badge(item: NavItem): number {
    switch (item.path) {
      case '/tasks':
        return this.pool.openCount();
      case '/essen':
        return this.meals.openMealCount();
      default:
        return 0;
    }
  }

  protected signOut(): void {
    // Auth navigates to /login on SIGNED_OUT.
    void this.auth.signOut();
  }
}
