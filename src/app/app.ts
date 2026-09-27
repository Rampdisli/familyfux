import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Auth } from './core/auth';
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

  protected readonly nav: NavItem[] = [
    { path: '/tasks', icon: '🗂️', label: 'Aufgaben-Pool', short: 'Aufgaben' },
    { path: '/kalender', icon: '📅', label: 'Kalender', short: 'Kalender' },
    { path: '/einkaufen', icon: '🛒', label: 'Einkaufen', short: 'Einkaufen' },
    { path: '/essensplan', icon: '🍝', label: 'Essensplan', short: 'Essen' },
  ];

  /** Badge count per nav item (only the task pool has live data so far). */
  protected badge(item: NavItem): number {
    return item.path === '/tasks' ? this.pool.openCount() : 0;
  }

  protected signOut(): void {
    // Auth navigates to /login on SIGNED_OUT.
    void this.auth.signOut();
  }
}
