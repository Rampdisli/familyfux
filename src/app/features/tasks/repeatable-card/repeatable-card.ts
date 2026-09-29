import { Component, computed, inject, input, signal } from '@angular/core';
import { RepeatableTask, TaskPool } from '../task-pool';

/**
 * A repeatable task ("Immer wieder"): never done for the day. Every "Erledigt!"
 * asks who did it and earns that member the task's stars; the counter shows
 * how often it was done today and starts again at midnight.
 */
@Component({
  selector: 'app-repeatable-card',
  templateUrl: './repeatable-card.html',
  styleUrl: './repeatable-card.scss',
  host: {
    '[class.done-today]': 'task().today.length > 0',
  },
})
export class RepeatableCard {
  protected readonly pool = inject(TaskPool);

  readonly task = input.required<RepeatableTask>();

  protected readonly pickerOpen = signal(false);
  /** Name of the member who was just credited, for the short "+2 ⭐ für Mia" cheer. */
  protected readonly cheer = signal<string | null>(null);

  /** Who did it today, newest first (one avatar per completion). */
  protected readonly doers = computed(() =>
    [...this.task().today].reverse().map((completion) => ({ completion, member: this.pool.member(completion.member_id) })),
  );

  /** Person picked in the brown bar: "Erledigt!" counts for them right away. */
  protected readonly selected = computed(() => this.pool.selectedMember());

  /** What "↩︎" takes back: the latest completion today — of the picked person, if any. */
  protected readonly last = computed(() => {
    const selected = this.selected();
    return selected ? this.doers().find((d) => d.completion.member_id === selected.id) : this.doers()[0];
  });

  /** "✓ Erledigt!": for the picked person directly, otherwise ask who. */
  protected done(): void {
    const selected = this.selected();
    if (selected) {
      this.complete(selected.id);
    } else {
      this.pickerOpen.set(true);
    }
  }

  private cheerTimer?: ReturnType<typeof setTimeout>;

  protected complete(memberId: string): void {
    this.pickerOpen.set(false);
    this.cheer.set(this.pool.member(memberId)?.name ?? null);
    clearTimeout(this.cheerTimer);
    this.cheerTimer = setTimeout(() => this.cheer.set(null), 1800);
    void this.pool.complete(this.task().id, memberId);
  }

  /** Takes back the latest completion of today (of the picked person, if any). */
  protected undo(): void {
    const last = this.last();
    if (last) {
      this.cheer.set(null);
      void this.pool.undoCompletion(last.completion);
    }
  }
}
