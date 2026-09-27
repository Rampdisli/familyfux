import { Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TaskCard } from '../task-card/task-card';
import { TaskPool, formatStars } from '../task-pool';

/** Finished entries stay visible this long, so a wrong tick can still be undone. */
const DONE_VISIBLE_MS = 60_000;

@Component({
  selector: 'app-task-list',
  imports: [RouterLink, TaskCard],
  templateUrl: './task-list.html',
  styleUrl: './task-list.scss',
})
export class TaskList {
  protected readonly pool = inject(TaskPool);

  private readonly now = signal(Date.now());

  /** Open entries, plus the ones finished less than a minute ago. */
  protected readonly visibleTasks = computed(() => {
    const cutoff = this.now() - DONE_VISIBLE_MS;
    return this.pool.tasks().filter((t) => !t.is_done || !t.done_at || Date.parse(t.done_at) > cutoff);
  });

  constructor() {
    // Re-evaluate right when the next finished entry's minute is up.
    // (Re-runs when the pool reloads; `now` may be stale then, so measure with the real clock.)
    effect((onCleanup) => {
      const now = Date.now();
      const waits = this.visibleTasks()
        .filter((t) => t.is_done && t.done_at)
        .map((t) => Date.parse(t.done_at!) + DONE_VISIBLE_MS - now);

      if (waits.length) {
        const timer = setTimeout(() => this.now.set(Date.now()), Math.max(0, Math.min(...waits)) + 50);
        onCleanup(() => clearTimeout(timer));
      }
    });
  }

  protected stars(stars: number): string {
    return formatStars(stars);
  }
}
