import { Injectable, computed, inject, resource, signal } from '@angular/core';
import { Auth } from '../../core/auth';
import { supabase } from '../../core/supabase-client';
import { Schedule, ScheduleParams } from './schedule';

/** Avatar / tile colours, mapped to CSS classes in the components. */
export type PoolColor = 'mint' | 'lilac' | 'sky' | 'rose' | 'peach' | 'lemon';

export const POOL_COLORS: readonly PoolColor[] = ['mint', 'lilac', 'sky', 'rose', 'peach', 'lemon'];

/** Stars a task can be worth (the DB only requires > 0). */
export const MAX_REWARD = 100;

/** Whole stars within 1…MAX_REWARD. */
export function clampReward(stars: number): number {
  return Math.min(MAX_REWARD, Math.max(1, Math.round(stars)));
}

/** Symbols offered when creating / editing a task. */
export const TASK_ICONS = ['🧸', '🦷', '🎒', '🐕', '🍽️', '🧺', '🌱', '🗑️', '📚', '🧹', '🚲', '🛏️'];

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

/** 'each': every participant earns the full reward; 'split': they share it. */
export type RewardMode = 'each' | 'split';

/** What the "Neue Aufgabe" / "Aufgaben verwalten" pages save into `tasks`. */
export type TaskInput = Pick<PoolTask, 'title' | 'emoji' | 'color' | 'reward' | 'reward_mode'> &
  ScheduleParams & { is_repeatable: boolean };

/** One participant of a pool entry (a row of task_claims); everybody ticks off their own part. */
export interface PoolClaim {
  id: string;
  member_id: string | null;
  is_done: boolean;
}

/** One occurrence of a task in the pool (a row of the task_pool view) with its participants. */
export interface PoolTask {
  /** Occurrence id — what gets joined and ticked off. */
  id: string;
  task_id: string;
  schedule: Schedule;
  title: string;
  emoji: string;
  color: PoolColor;
  reward: number;
  reward_mode: RewardMode;
  /** All participants are done. */
  is_done: boolean;
  /** When the last participant finished. */
  done_at: string | null;
  claims: PoolClaim[];
}

/** One "done" of a repeatable task today (a row of the task_completions_today view). */
export interface TodayCompletion {
  id: string;
  member_id: string | null;
  completed_at: string;
}

/**
 * A repeatable task ("Immer wieder"): always in its own section of the pool,
 * ticked off any number of times a day, each time for one member.
 */
export interface RepeatableTask {
  id: string;
  title: string;
  emoji: string;
  color: PoolColor;
  /** Stars per completion. */
  reward: number;
  /** Today's completions (family time zone), oldest first — the "3× heute" counter. */
  today: TodayCompletion[];
}

/** Where the person picked in the brown bar is remembered on this device. */
const SELECTED_MEMBER_KEY = 'fuxi.selectedMemberId';

function readSelectedMember(): string | null {
  try {
    return localStorage.getItem(SELECTED_MEMBER_KEY);
  } catch {
    return null;
  }
}

/** "Mias", "Klaus'" — German genitive, e.g. for "Mias Aufgaben". */
export function possessive(name: string): string {
  return /[sxzß]$/i.test(name) ? `${name}’` : `${name}s`;
}

/** Stars can be fractional when shared: 1.5 → "1,5". */
export function formatStars(stars: number): string {
  return stars.toLocaleString('de-DE', { maximumFractionDigits: 2 });
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

      const [members, pool, stars, balances, repeatable, completions] = await Promise.all([
        supabase
          .from('family_members')
          .select('id, family_id, user_id, name, emoji, color, role')
          .order('sort_order')
          .order('created_at'),
        supabase
          .from('task_pool')
          .select('id, task_id, schedule, title, emoji, color, reward, reward_mode, is_done, done_at')
          .order('is_done')
          .order('due_date')
          .order('title'),
        supabase.from('member_week_stars').select('member_id, stars'),
        supabase.from('member_balance').select('member_id, balance'),
        supabase
          .from('tasks')
          .select('id, title, emoji, color, reward')
          .eq('is_repeatable', true)
          .is('archived_at', null)
          .order('title'),
        supabase.from('task_completions_today').select('id, task_id, member_id, completed_at').order('completed_at'),
      ]);

      // Participants of the entries currently in the pool.
      const claims = pool.data?.length
        ? await supabase
            .from('task_claims')
            .select('id, occurrence_id, member_id, is_done')
            .in('occurrence_id', pool.data.map((t) => t.id))
            // Parts a parent removed from the history (remove_done_entry).
            .is('removed_at', null)
            .order('claimed_at')
        : { data: [], error: null };

      const error =
        members.error ??
        pool.error ??
        stars.error ??
        balances.error ??
        repeatable.error ??
        completions.error ??
        claims.error;
      if (error) {
        // PostgrestError is a plain object; resource() needs an Error to expose its message.
        throw new Error(error.message, { cause: error });
      }

      const claimsByOccurrence = new Map<string, PoolClaim[]>();
      for (const { occurrence_id, ...claim } of (claims.data ?? []) as (PoolClaim & { occurrence_id: string })[]) {
        claimsByOccurrence.set(occurrence_id, [...(claimsByOccurrence.get(occurrence_id) ?? []), claim]);
      }

      const todayByTask = new Map<string, TodayCompletion[]>();
      for (const { task_id, ...completion } of (completions.data ?? []) as (TodayCompletion & { task_id: string })[]) {
        todayByTask.set(task_id, [...(todayByTask.get(task_id) ?? []), completion]);
      }

      return {
        family: members.data as FamilyMember[],
        tasks: (pool.data as Omit<PoolTask, 'claims'>[]).map((t) => ({
          ...t,
          claims: claimsByOccurrence.get(t.id) ?? [],
        })),
        repeatable: (repeatable.data as Omit<RepeatableTask, 'today'>[]).map((t) => ({
          ...t,
          today: todayByTask.get(t.id) ?? [],
        })),
        stars: Object.fromEntries(
          (stars.data ?? []).map((s) => [s.member_id, Number(s.stars)]),
        ) as Partial<Record<string, number>>,
        balances: Object.fromEntries(
          (balances.data ?? []).map((b) => [b.member_id, Number(b.balance)]),
        ) as Partial<Record<string, number>>,
      };
    },
  });

  readonly family = computed(() => this.data.value()?.family ?? []);
  readonly tasks = computed(() => this.data.value()?.tasks ?? []);
  readonly repeatable = computed(() => this.data.value()?.repeatable ?? []);
  /** Stars earned this week, per member id. */
  readonly stars = computed(() => this.data.value()?.stars ?? {});
  /** Guthaben per member id: all stars ever earned minus rewards bought (member_balance). */
  readonly balances = computed(() => this.data.value()?.balances ?? {});

  /** The signed-in user's own member entry. */
  readonly me = computed(() => this.family().find((m) => m.user_id === this.auth.user()?.id));
  readonly isParent = computed(() => this.me()?.role === 'parent');
  /** Signed in with a kid's own account: the brown bar is fixed to them. */
  readonly isChildLogin = computed(() => this.me()?.role === 'child');

  /** Person picked in the brown bar by a parent; null = "Alle". */
  private readonly chosenMemberId = signal<string | null>(readSelectedMember());

  /**
   * The person the pages are about: a kid login is always themselves,
   * otherwise whoever was picked in the brown bar (null = "Alle").
   */
  readonly selectedMemberId = computed<string | null>(() => {
    const me = this.me();
    if (me?.role === 'child') {
      return me.id;
    }
    const id = this.chosenMemberId();
    return id && this.member(id) ? id : null;
  });

  readonly selectedMember = computed(() => this.member(this.selectedMemberId()));

  /** Picks a person in the brown bar (null = "Alle"); remembered on this device. Kid logins can't switch. */
  selectMember(id: string | null): void {
    if (this.isChildLogin()) {
      return;
    }
    this.chosenMemberId.set(id);
    try {
      if (id) {
        localStorage.setItem(SELECTED_MEMBER_KEY, id);
      } else {
        localStorage.removeItem(SELECTED_MEMBER_KEY);
      }
    } catch {
      // Private mode etc.: the choice just isn't remembered.
    }
  }

  balance(memberId: string | null | undefined): number {
    return (memberId && this.balances()[memberId]) || 0;
  }

  member(id: string | null | undefined): FamilyMember | undefined {
    return this.family().find((m) => m.id === id);
  }

  /** Adds a participant; `done` for "has already done it". */
  join(occurrenceId: string, memberId: string, done = false): Promise<void> {
    return this.writeClaim(
      supabase.from('task_claims').insert({ occurrence_id: occurrenceId, member_id: memberId, is_done: done }),
    );
  }

  /** Steps out again (only while their part isn't done). */
  leave(claim: PoolClaim): Promise<void> {
    return this.writeClaim(supabase.from('task_claims').delete().eq('id', claim.id));
  }

  toggleDone(claim: PoolClaim): Promise<void> {
    return this.writeClaim(supabase.from('task_claims').update({ is_done: !claim.is_done }).eq('id', claim.id));
  }

  /** One more "done" of a repeatable task, for the member who did it (earns them its stars). */
  complete(taskId: string, memberId: string): Promise<void> {
    return this.writeClaim(supabase.from('task_completions').insert({ task_id: taskId, member_id: memberId }));
  }

  /** "Rückgängig": removes a completion again (only today's; the DB refuses older ones). */
  undoCompletion(completion: TodayCompletion): Promise<void> {
    return this.writeClaim(supabase.from('task_completions').delete().eq('id', completion.id));
  }

  /** Creates a task (one-off, recurring or repeatable), optionally assigned to members. Resolves to an error message, if any. */
  async createTask(input: TaskInput, assignees: string[] = []): Promise<string | null> {
    const userId = this.auth.user()?.id;
    if (!userId) {
      return 'Du bist nicht angemeldet.';
    }

    // family_id comes from the tasks_before_write trigger, the first occurrence from tasks_after_insert.
    const { data, error } = await supabase.from('tasks').insert({ ...input, user_id: userId }).select('id').single();
    if (error) {
      this.data.reload();
      return error.message;
    }

    // Assignees join the open occurrence right away (task_assignees_after_write).
    return this.mutate(this.assign(data.id, assignees));
  }

  /** Saves an edited task; the DB moves open pool entries to the new schedule / reward / assignees. */
  async updateTask(
    taskId: string,
    input: TaskInput,
    assignees: { add: string[]; remove: string[] },
  ): Promise<string | null> {
    const updated = await supabase.from('tasks').update(input).eq('id', taskId);
    if (updated.error) {
      this.data.reload();
      return updated.error.message;
    }

    if (assignees.remove.length) {
      const removed = await supabase
        .from('task_assignees')
        .delete()
        .eq('task_id', taskId)
        .in('member_id', assignees.remove);
      if (removed.error) {
        this.data.reload();
        return removed.error.message;
      }
    }

    return this.mutate(this.assign(taskId, assignees.add));
  }

  private assign(taskId: string, memberIds: string[]): PromiseLike<{ error: { message: string } | null }> {
    return memberIds.length
      ? supabase.from('task_assignees').insert(memberIds.map((member_id) => ({ task_id: taskId, member_id })))
      : Promise.resolve({ error: null });
  }

  /** "Löschen" archives: the task leaves the pool, its history stays. Restoring brings it back. */
  setTaskArchived(taskId: string, archived: boolean): Promise<string | null> {
    return this.mutate(
      supabase
        .from('tasks')
        .update({ archived_at: archived ? new Date().toISOString() : null })
        .eq('id', taskId),
    );
  }

  /** Adds a member to the signed-in user's family. Resolves to an error message, if any. */
  addMember(draft: MemberDraft): Promise<string | null> {
    const familyId = this.me()?.family_id;
    if (!familyId) {
      return Promise.resolve('Du gehörst zu keiner Familie.');
    }

    return this.mutate(
      supabase.from('family_members').insert({ ...draft, family_id: familyId, sort_order: this.family().length }),
    );
  }

  updateMember(id: string, draft: MemberDraft): Promise<string | null> {
    return this.mutate(supabase.from('family_members').update(draft).eq('id', id));
  }

  removeMember(id: string): Promise<string | null> {
    return this.mutate(supabase.from('family_members').delete().eq('id', id));
  }

  /** Runs a write, reloads the pool and resolves to the error message, if any. */
  private async mutate(query: PromiseLike<{ error: { message: string } | null }>): Promise<string | null> {
    const { error } = await query;
    this.data.reload();
    return error?.message ?? null;
  }

  /** Pool actions show their error above the pool instead of returning it. */
  private async writeClaim(query: PromiseLike<{ error: { message: string } | null }>): Promise<void> {
    this.errorMessage.set(null);

    const { error } = await query;
    if (error) {
      this.errorMessage.set(error.message);
    }

    // Reload in any case: refreshes the stars, or reverts the card on error.
    this.data.reload();
  }
}
