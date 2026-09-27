import { Component, model } from '@angular/core';
import { MAX_REWARD, clampReward } from '../task-pool';

/** − [3] ⭐ + — stars of a task, 1…MAX_REWARD; the number can also be typed. */
@Component({
  selector: 'app-reward-stepper',
  template: `
    <button type="button" aria-label="Weniger Sterne" [disabled]="value() <= 1" (click)="change(-1)">−</button>
    <label class="val">
      <input
        #input
        type="number"
        min="1"
        [max]="max"
        aria-label="Sterne"
        [value]="value()"
        (change)="type(input)"
      />
      ⭐
    </label>
    <button type="button" aria-label="Mehr Sterne" [disabled]="value() >= max" (click)="change(1)">+</button>
  `,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      gap: 12px;
      padding: 6px 8px;
      border-radius: 14px;
      background: var(--stepper-bg, var(--cream));
    }

    button {
      width: 30px;
      height: 30px;
      border: none;
      border-radius: 10px;
      background: var(--stepper-button-bg, #fff);
      font-size: 17px;
      font-weight: 700;
      color: var(--orange-deep);
      cursor: pointer;
      box-shadow: 0 4px 10px var(--shadow-warm);

      &:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }
    }

    .val {
      display: flex;
      align-items: center;
      gap: 2px;
      font-family: var(--font-display);
      font-weight: 600;
      font-size: 16px;
    }

    input {
      width: 3.2ch;
      padding: 0;
      border: none;
      background: transparent;
      font: inherit;
      text-align: right;
      color: inherit;
      outline: none;
      appearance: textfield;

      &::-webkit-inner-spin-button,
      &::-webkit-outer-spin-button {
        appearance: none;
        margin: 0;
      }

      &:focus {
        border-bottom: 2px solid var(--orange);
      }
    }
  `,
})
export class RewardStepper {
  readonly value = model.required<number>();

  protected readonly max = MAX_REWARD;

  protected change(delta: number): void {
    this.value.update((stars) => clampReward(stars + delta));
  }

  /** Typed value, clamped and written back (so "150" visibly becomes "100"); junk keeps the old value. */
  protected type(input: HTMLInputElement): void {
    const typed = Number.parseInt(input.value, 10);
    const stars = Number.isFinite(typed) ? clampReward(typed) : this.value();
    input.value = String(stars);
    this.value.set(stars);
  }
}
