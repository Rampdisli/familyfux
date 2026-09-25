import { Component, computed, inject, input, signal } from '@angular/core';
import { PoolTask, TaskPool } from '../task-pool';

@Component({
  selector: 'app-task-card',
  templateUrl: './task-card.html',
  styleUrl: './task-card.scss',
  host: {
    '[class.claimed]': '!!task().claimed_by',
    '[class.completed]': 'task().is_done',
  },
})
export class TaskCard {
  protected readonly pool = inject(TaskPool);

  readonly task = input.required<PoolTask>();

  protected readonly pickerOpen = signal(false);
  protected readonly claimer = computed(() => this.pool.member(this.task().claimed_by));

  protected claim(memberId: string): void {
    this.pickerOpen.set(false);
    void this.pool.claim(this.task().id, memberId);
  }

  protected toggleDone(): void {
    void this.pool.toggleDone(this.task());
  }
}
