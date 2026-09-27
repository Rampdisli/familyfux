import { NgTemplateOutlet } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FamilyMember, MemberDraft, POOL_COLORS, TaskPool } from '../tasks/task-pool';

const ROLE_LABELS: Record<FamilyMember['role'], string> = { parent: 'Elternteil', child: 'Kind' };

/**
 * "Familie verwalten" — parents add, edit and remove family members.
 * Only one card is in edit mode at a time; `draft` holds its unsaved values.
 */
@Component({
  selector: 'app-family-admin',
  imports: [NgTemplateOutlet, RouterLink],
  templateUrl: './family-admin.html',
  styleUrl: './family-admin.scss',
})
export class FamilyAdmin {
  protected readonly pool = inject(TaskPool);

  protected readonly icons = ['🦊', '🐻', '🦉', '🐰', '🐱', '🐶', '🐼', '🐢', '🐨', '🐹'];
  protected readonly colors = POOL_COLORS;
  protected readonly roleLabels = ROLE_LABELS;

  /** Member being edited, or 'new' for the "Mitglied hinzufügen" card. */
  protected readonly editing = signal<string | null>(null);
  protected readonly draft = signal<MemberDraft>(this.emptyDraft());
  protected readonly deleteArmed = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  protected edit(member: FamilyMember): void {
    const { name, emoji, color, role } = member;
    this.open(member.id, { name, emoji, color, role });
  }

  protected startAdd(): void {
    if (this.editing() !== 'new') {
      this.open('new', this.emptyDraft());
    }
  }

  protected cancel(): void {
    this.editing.set(null);
  }

  protected patch(changes: Partial<MemberDraft>): void {
    this.draft.update((draft) => ({ ...draft, ...changes }));
  }

  protected async save(): Promise<void> {
    const id = this.editing();
    const draft = { ...this.draft(), name: this.draft().name.trim() };
    if (!id || !draft.name) {
      return;
    }

    this.saving.set(true);
    const error =
      id === 'new' ? await this.pool.addMember(draft) : await this.pool.updateMember(id, draft);
    this.saving.set(false);

    this.errorMessage.set(error);
    if (!error) {
      this.editing.set(null);
    }
  }

  /** First click arms the button ("Wirklich löschen?"), the second one deletes. */
  protected async remove(member: FamilyMember): Promise<void> {
    if (this.deleteArmed() !== member.id) {
      this.deleteArmed.set(member.id);
      return;
    }

    this.deleteArmed.set(null);
    this.errorMessage.set(await this.pool.removeMember(member.id));
  }

  private open(id: string, draft: MemberDraft): void {
    this.editing.set(id);
    this.draft.set(draft);
    this.deleteArmed.set(null);
    this.errorMessage.set(null);
  }

  private emptyDraft(): MemberDraft {
    return { name: '', emoji: this.icons[0], color: POOL_COLORS[0], role: 'child' };
  }
}
