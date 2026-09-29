import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { RepeatableCard } from '../repeatable-card/repeatable-card';
import { TaskCard } from '../task-card/task-card';
import { TaskPool, possessive } from '../task-pool';

/** Finished entries stay visible this long, so a wrong tick can still be undone. */
const DONE_VISIBLE_MS = 60_000;

@Component({
  selector: 'app-task-list',
  imports: [NgTemplateOutlet, RepeatableCard, RouterLink, TaskCard],
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

  /** Person picked in the brown bar; null = "Alle". */
  protected readonly person = computed(() => this.pool.selectedMember());

  /** "Mias Aufgaben": everything the person takes part in, finished ones too (until they fade out). */
  protected readonly mine = computed(() => {
    const id = this.person()?.id;
    return this.visibleTasks().filter((t) => t.claims.some((c) => c.member_id === id));
  });

  /** "Noch frei": nobody took them yet. */
  protected readonly free = computed(() => this.visibleTasks().filter((t) => t.claims.length === 0));

  protected readonly possessive = computed(() => possessive(this.person()?.name ?? ''));

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

    // The "3× heute" counters start again at midnight: reload then if the page is still open.
    effect((onCleanup) => {
      this.pool.repeatable();
      const now = new Date();
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      const timer = setTimeout(() => this.pool.data.reload(), midnight.getTime() - now.getTime() + 1000);
      onCleanup(() => clearTimeout(timer));
    });
  }

  /** "Immer wieder" button: jumps down to the repeatable tasks. */
  protected jumpToRepeatable(section: HTMLElement): void {
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
