import { NgTemplateOutlet } from '@angular/common';
import { Component, inject, resource, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { supabase } from '../../core/supabase-client';
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

  /** Member whose "Konto verknüpfen" form is open, and the email typed there. */
  protected readonly linking = signal<string | null>(null);
  protected readonly linkEmail = signal('');
  protected readonly unlinkArmed = signal<string | null>(null);

  /** Email of each linked member's account (parents only, family_member_accounts). */
  protected readonly accounts = resource({
    params: () => ({ family: this.pool.family() }),
    loader: async () => {
      const { data, error } = await supabase.rpc('family_member_accounts');
      if (error) {
        throw new Error(error.message, { cause: error });
      }
      return new Map((data as { member_id: string; email: string }[]).map((a) => [a.member_id, a.email]));
    },
  });

  protected accountEmail(member: FamilyMember): string {
    return this.accounts.value()?.get(member.id) ?? 'eigenes Konto';
  }

  /** "🔑 Konto verknüpfen": the kid signed up on the login page; a parent enters that email here. */
  protected startLink(member: FamilyMember): void {
    this.linking.set(member.id);
    this.linkEmail.set('');
    this.unlinkArmed.set(null);
    this.errorMessage.set(null);
  }

  protected async link(member: FamilyMember): Promise<void> {
    const email = this.linkEmail().trim();
    if (!email) {
      return;
    }

    this.saving.set(true);
    const error = await this.pool.linkAccount(member.id, email);
    this.saving.set(false);

    this.errorMessage.set(error);
    if (!error) {
      this.linking.set(null);
    }
  }

  /** First click arms "Lösen", the second removes the login link. */
  protected async unlink(member: FamilyMember): Promise<void> {
    if (this.unlinkArmed() !== member.id) {
      this.unlinkArmed.set(member.id);
      return;
    }

    this.unlinkArmed.set(null);
    this.errorMessage.set(await this.pool.unlinkAccount(member.id));
  }

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
