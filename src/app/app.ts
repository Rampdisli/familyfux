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
    { path: '/essen', icon: '🍝', label: 'Essen', short: 'Essen' },
  ];

  protected signOut(): void {
    // Auth navigates to /login on SIGNED_OUT.
    void this.auth.signOut();
  }
}
