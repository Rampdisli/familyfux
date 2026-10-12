import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { environment } from '../environments/environment';
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

  /** Version footer: package.json version, commit and build time of this bundle. */
  protected readonly build = environment.build;
  protected readonly commitUrl = `https://github.com/Rampdisli/familyfux/commit/${environment.build.commit}`;
  protected readonly builtAt = formatBuiltAt(environment.build.builtAt);

  /** Parents only: purchases of the whole family nobody ticked off yet, on "Belohnungen". */
  protected badge(item: NavItem): number {
    return item.path === '/belohnungen' && this.pool.isParent() ? this.rewards.open().length : 0;
  }

  /**
   * Full page reload. The app is mostly used from the home screen, where there
   * is no browser reload button; this also picks up a freshly deployed version.
   */
  protected reload(): void {
    window.location.reload();
  }

  protected signOut(): void {
    // Auth navigates to /login on SIGNED_OUT.
    void this.auth.signOut();
  }
}

/** "12.10.2026 15:09" in the viewer's time zone; "" without a build timestamp. (No DatePipe: it would push the initial bundle over its budget.) */
function formatBuiltAt(iso: string): string {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) {
    return '';
  }
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(d.getDate())}.${two(d.getMonth() + 1)}.${d.getFullYear()} ${two(d.getHours())}:${two(d.getMinutes())}`;
}
