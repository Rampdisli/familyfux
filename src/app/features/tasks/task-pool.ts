import { Injectable, computed, inject, resource, signal } from '@angular/core';
import { Auth } from '../../core/auth';
import { supabase } from '../../core/supabase-client';

/** Avatar / tile colours, mapped to CSS classes in the components. */
export type PoolColor = 'mint' | 'lilac' | 'sky' | 'rose' | 'peach' | 'lemon';

export interface FamilyMember {
  id: string;
  name: string;
  emoji: string;
  color: PoolColor;
}

export interface PoolTask {
  id: string;
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

      const [members, tasks, stars] = await Promise.all([
        supabase
          .from('family_members')
          .select('id, name, emoji, color')
          .order('sort_order')
          .order('created_at'),
        supabase
          .from('tasks')
          .select('id, title, emoji, color, reward, claimed_by, is_done')
          .order('is_done')
          .order('created_at'),
        supabase.from('member_week_stars').select('member_id, stars'),
      ]);

      const error = members.error ?? tasks.error ?? stars.error;
      if (error) {
        throw error;
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

  member(id: string | null | undefined): FamilyMember | undefined {
    return this.family().find((m) => m.id === id);
  }

  claim(taskId: string, memberId: string): Promise<void> {
    return this.updateTask(taskId, { claimed_by: memberId });
  }

  toggleDone(task: PoolTask): Promise<void> {
    return this.updateTask(task.id, { is_done: !task.is_done });
  }

  private async updateTask(taskId: string, changes: Partial<PoolTask>): Promise<void> {
    this.errorMessage.set(null);

    const { error } = await supabase.from('tasks').update(changes).eq('id', taskId);

    if (error) {
      this.errorMessage.set(error.message);
    }

    // Reload in any case: refreshes the stars, or reverts the card on error.
    this.data.reload();
  }
}
