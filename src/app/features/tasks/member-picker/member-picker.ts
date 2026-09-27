import { Component, inject, model } from '@angular/core';
import { TaskPool } from '../task-pool';

/**
 * Optional "Zuweisen" field: pick any number of family members.
 * Nobody picked = the task stays up for grabs in the pool.
 */
@Component({
  selector: 'app-member-picker',
  template: `
    <div class="chips" role="group" aria-label="Zuweisen">
      @for (member of pool.family(); track member.id) {
        <button
          type="button"
          class="chip"
          [class.active]="selected().includes(member.id)"
          [attr.aria-pressed]="selected().includes(member.id)"
          (click)="toggle(member.id)"
        >
          <span class="av av-{{ member.color }}">{{ member.emoji }}</span>
          {{ member.name }}
        </button>
      }
    </div>
  `,
  styles: `
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .chip {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 5px 12px 5px 5px;
      border: 2px solid var(--cream-deep);
      border-radius: 20px;
      background: var(--chip-bg, #fff);
      font: inherit;
      font-weight: 600;
      font-size: 13px;
      color: var(--brown-soft);
      cursor: pointer;

      &.active {
        border-color: var(--orange);
        color: var(--brown);
      }
    }

    .av {
      width: 26px;
      height: 26px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
    }
  `,
})
export class MemberPicker {
  protected readonly pool = inject(TaskPool);

  /** Selected member ids. */
  readonly selected = model.required<string[]>();

  protected toggle(id: string): void {
    this.selected.update((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }
}
