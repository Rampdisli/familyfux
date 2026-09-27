import { Injectable, computed, inject, resource, signal } from '@angular/core';
import { Auth } from '../../core/auth';
import { supabase } from '../../core/supabase-client';
import { Schedule, ScheduleParams } from './schedule';

/** Avatar / tile colours, mapped to CSS classes in the components. */
export type PoolColor = 'mint' | 'lilac' | 'sky' | 'rose' | 'peach' | 'lemon';

export const POOL_COLORS: readonly PoolColor[] = ['mint', 'lilac', 'sky', 'rose', 'peach', 'lemon'];

export type MemberRole = 'parent' | 'child';

export interface FamilyMember {
  id: string;
  family_id: string;
  /** Login linked to this member; null for members without an account (e.g. kids). */
  user_id: string | null;
  name: string;
  emoji: string;
  color: PoolColor;
  role: MemberRole;
}

/** The fields a parent can edit on the "Familie verwalten" page. */
export type MemberDraft = Pick<FamilyMember, 'name' | 'emoji' | 'color' | 'role'>;

/** One occurrence of a task in the pool (a row of the task_pool view). */
/** What the "Neue Aufgabe" page saves into `tasks`. */
export type TaskInput = Pick<PoolTask, 'title' | 'emoji' | 'color' | 'reward'> & ScheduleParams;

export interface PoolTask {
  /** Occurrence id — what gets claimed and ticked off. */
  id: string;
  task_id: string;
  schedule: Schedule;
  title: string;
  emoji: string;
  color: PoolColor;
  reward: number;
  claimed_by: string | null;
  is_done: boolean;
}

/**
 * The signed-in user's family and its task pool, loaded from Supabase.
 * RLS limits every query to the families the user belongs to.
 */
@Injectable({ providedIn: 'root' })
export class TaskPool {
  private readonly auth = inject(Auth);

  readonly errorMessage = signal<string | null>(null);

  readonly data = resource({
    params: () => ({ userId: this.auth.user()?.id }),
    loader: async ({ params }) => {
      if (!params.userId) {
        return null;
      }

      // Adds the occurrences that became due since the last visit (recurring tasks).
      const refresh = await supabase.rpc('refresh_task_pool');
      if (refresh.error) {
        throw new Error(refresh.error.message, { cause: refresh.error });
      }

      const [members, tasks, stars] = await Promise.all([
        supabase
          .from('family_members')
          .select('id, family_id, user_id, name, emoji, color, role')
          .order('sort_order')
          .order('created_at'),
        supabase
          .from('task_pool')
          .select('id, task_id, schedule, title, emoji, color, reward, claimed_by, is_done')
          .order('is_done')
          .order('due_date')
          .order('title'),
        supabase.from('member_week_stars').select('member_id, stars'),
      ]);

      const error = members.error ?? tasks.error ?? stars.error;
      if (error) {
        // PostgrestError is a plain object; resource() needs an Error to expose its message.
        throw new Error(error.message, { cause: error });
      }

      return {
        family: members.data as FamilyMember[],
        tasks: tasks.data as PoolTask[],
        stars: Object.fromEntries(
          (stars.data ?? []).map((s) => [s.member_id, s.stars]),
        ) as Partial<Record<string, number>>,
      };
    },
  });

  readonly family = computed(() => this.data.value()?.family ?? []);
  readonly tasks = computed(() => this.data.value()?.tasks ?? []);
  readonly stars = computed(() => this.data.value()?.stars ?? {});

  /** The signed-in user's own member entry. */
  readonly me = computed(() => this.family().find((m) => m.user_id === this.auth.user()?.id));
  readonly isParent = computed(() => this.me()?.role === 'parent');

  /** Tasks nobody has finished yet (badge in the navigation). */
  readonly openCount = computed(() => this.tasks().filter((t) => !t.is_done).length);

  member(id: string | null | undefined): FamilyMember | undefined {
    return this.family().find((m) => m.id === id);
  }

  claim(occurrenceId: string, memberId: string): Promise<void> {
    return this.updateOccurrence(occurrenceId, { claimed_by: memberId });
  }

  toggleDone(task: PoolTask): Promise<void> {
    return this.updateOccurrence(task.id, { is_done: !task.is_done });
  }

  /** Creates a task (one-off or recurring). Resolves to an error message, if any. */
  async createTask(input: TaskInput): Promise<string | null> {
    const userId = this.auth.user()?.id;
    if (!userId) {
      return 'Du bist nicht angemeldet.';
    }

    // family_id comes from the tasks_before_write trigger, the first occurrence from tasks_after_insert.
    const { error } = await supabase.from('tasks').insert({ ...input, user_id: userId });
    this.data.reload();
    return error?.message ?? null;
  }

  /** Adds a member to the signed-in user's family. Resolves to an error message, if any. */
  addMember(draft: MemberDraft): Promise<string | null> {
    const familyId = this.me()?.family_id;
    if (!familyId) {
      return Promise.resolve('Du gehörst zu keiner Familie.');
    }

    return this.changeMembers(
      supabase.from('family_members').insert({ ...draft, family_id: familyId, sort_order: this.family().length }),
    );
  }

  updateMember(id: string, draft: MemberDraft): Promise<string | null> {
    return this.changeMembers(supabase.from('family_members').update(draft).eq('id', id));
  }

  removeMember(id: string): Promise<string | null> {
    return this.changeMembers(supabase.from('family_members').delete().eq('id', id));
  }

  private async changeMembers(query: PromiseLike<{ error: { message: string } | null }>): Promise<string | null> {
    const { error } = await query;
    this.data.reload();
    return error?.message ?? null;
  }

  private async updateOccurrence(
    occurrenceId: string,
    changes: Partial<Pick<PoolTask, 'claimed_by' | 'is_done'>>,
  ): Promise<void> {
    this.errorMessage.set(null);

    const { error } = await supabase.from('task_occurrences').update(changes).eq('id', occurrenceId);

    if (error) {
      this.errorMessage.set(error.message);
    }

    // Reload in any case: refreshes the stars, or reverts the card on error.
    this.data.reload();
  }
}
