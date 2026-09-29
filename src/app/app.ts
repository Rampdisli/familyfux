import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Auth } from './core/auth';
import { MemberBar } from './features/member-bar/member-bar';
import { Rewards } from './features/rewards/rewards';
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
  imports: [MemberBar, RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly auth = inject(Auth);
  protected readonly pool = inject(TaskPool);
  protected readonly rewards = inject(Rewards);

  protected readonly nav: NavItem[] = [
    { path: '/tasks', icon: '🗂️', label: 'Aufgaben-Pool', short: 'Aufgaben' },
    { path: '/belohnungen', icon: '🎁', label: 'Belohnungen', short: 'Belohnungen' },
    { path: '/profil', icon: '👤', label: 'Profil', short: 'Profil' },
    { path: '/essen', icon: '🍝', label: 'Essen', short: 'Essen' },
  ];

  /** Parents only: purchases of the whole family nobody ticked off yet, on "Belohnungen". */
  protected badge(item: NavItem): number {
    return item.path === '/belohnungen' && this.pool.isParent() ? this.rewards.open().length : 0;
  }

  protected signOut(): void {
    // Auth navigates to /login on SIGNED_OUT.
    void this.auth.signOut();
  }
}
