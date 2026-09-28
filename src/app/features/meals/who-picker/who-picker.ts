import { Component, inject, model } from '@angular/core';
import { TaskPool } from '../../tasks/task-pool';

/** "Ich bin:" — picks the family member ratings, wishes and planned meals are recorded for. */
@Component({
  selector: 'app-who-picker',
  template: `
    <div class="who-row" role="group" aria-label="Ich bin">
      <span class="who-label">Ich bin:</span>
      @for (member of pool.family(); track member.id) {
        <button
          type="button"
          class="who-avatar av-{{ member.color }}"
          [class.active]="selected() === member.id"
          [attr.aria-pressed]="selected() === member.id"
          [title]="member.name"
          [attr.aria-label]="member.name"
          (click)="selected.set(member.id)"
        >
          {{ member.emoji }}
        </button>
      }
    </div>
  `,
  styles: `
    .who-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px;
      width: fit-content;
      background: #fff;
      padding: 8px 8px 8px 14px;
      border-radius: 16px;
      box-shadow: 0 8px 18px var(--shadow-warm);
    }

    .who-label {
      font-size: 12px;
      font-weight: 700;
      color: var(--brown-soft);
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }

    .who-avatar {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      border: 2.5px solid transparent;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 17px;
      cursor: pointer;
      opacity: 0.55;

      &.active {
        border-color: var(--brown);
        opacity: 1;
        transform: scale(1.06);
      }
    }
  `,
})
export class WhoPicker {
  protected readonly pool = inject(TaskPool);

  /** Selected member id. */
  readonly selected = model.required<string | null>();
}
