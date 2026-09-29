import { Component, ElementRef, afterRenderEffect, inject, viewChild } from '@angular/core';
import { TaskPool, formatStars } from '../tasks/task-pool';

/**
 * The brown bar at the very top: who the pages are about. Parents pick
 * "Alle" or any member; a kid login only sees (and stays) themselves.
 * Every pill shows the member's Guthaben (member_balance).
 */
@Component({
  selector: 'app-member-bar',
  templateUrl: './member-bar.html',
  styleUrl: './member-bar.scss',
  host: {
    role: 'region',
    'aria-label': 'Wer ist dran?',
  },
})
export class MemberBar {
  protected readonly pool = inject(TaskPool);

  private readonly pills = viewChild<ElementRef<HTMLElement>>('pills');

  constructor() {
    // Phones: the bar scrolls sideways; keep the active pill in view after every change.
    afterRenderEffect(() => {
      this.pool.selectedMemberId();
      this.pool.family();
      const pills = this.pills()?.nativeElement;
      const active = pills?.querySelector<HTMLElement>('.wb-pill.active');
      if (!pills || !active) {
        return;
      }
      const left = active.offsetLeft - pills.offsetLeft;
      const right = left + active.offsetWidth;
      if (left < pills.scrollLeft) {
        pills.scrollLeft = left - 8;
      } else if (right > pills.scrollLeft + pills.clientWidth) {
        pills.scrollLeft = right - pills.clientWidth + 8;
      }
    });
  }

  protected balance(memberId: string): string {
    return formatStars(this.pool.balance(memberId));
  }
}
