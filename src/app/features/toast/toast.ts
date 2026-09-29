import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';

/** How long a message stays. */
const VISIBLE_MS = 3500;

/**
 * Short confirmation after navigating, e.g. "✓ Rezept gespeichert": the
 * message comes with the navigation, as router state `{ toast: '…' }`.
 * Taken out of the history entry once shown, so reloading doesn't repeat it.
 */
@Component({
  selector: 'app-toast',
  template: `
    <div class="toast" role="status" [class.on]="message()">{{ message() }}</div>
  `,
  styles: `
    .toast {
      position: fixed;
      left: 50%;
      bottom: calc(24px + env(safe-area-inset-bottom, 0px));
      z-index: 400;
      width: max-content;
      max-width: calc(100% - 32px);
      padding: 14px 18px;
      border-radius: 16px;
      background: var(--brown);
      color: var(--cream);
      font-weight: 700;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
      transform: translateX(-50%);
      visibility: hidden;
    }

    .toast.on {
      visibility: visible;
    }

    @media (max-width: 640px) {
      /* Above the bottom tab bar. */
      .toast {
        bottom: calc(96px + env(safe-area-inset-bottom, 0px));
      }
    }
  `,
})
export class Toast {
  protected readonly message = signal('');

  private timer?: ReturnType<typeof setTimeout>;

  constructor() {
    const router = inject(Router);
    this.show();
    router.events
      .pipe(
        filter((e) => e instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.show());
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
  }

  private show(): void {
    const state = history.state as { toast?: string } | null;
    if (!state?.toast) {
      return;
    }
    this.message.set(state.toast);
    history.replaceState({ ...state, toast: undefined }, '');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.message.set(''), VISIBLE_MS);
  }
}
