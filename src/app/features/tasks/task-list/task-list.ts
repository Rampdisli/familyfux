import { Component, inject, resource, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Auth } from '../../../core/auth';
import { supabase } from '../../../core/supabase-client';

interface Task {
  id: string;
  title: string;
  is_done: boolean;
  created_at: string;
}

@Component({
  selector: 'app-task-list',
  imports: [FormsModule, RouterLink],
  templateUrl: './task-list.html',
  styleUrl: './task-list.scss',
})
export class TaskList {
  private readonly auth = inject(Auth);

  protected readonly newTitle = signal('');
  protected readonly errorMessage = signal<string | null>(null);

  /**
   * Demo usage of `resource()` scoped to the signed-in user, reloaded
   * manually after writes. Assumes a `tasks` table as described in the README.
   */
  protected readonly tasks = resource({
    params: () => ({ userId: this.auth.user()?.id }),
    loader: async ({ params }) => {
      if (!params.userId) {
        return [];
      }

      const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .eq('user_id', params.userId)
        .order('created_at', { ascending: false });

      if (error) {
        throw error;
      }

      return data as Task[];
    },
  });

  protected async addTask(): Promise<void> {
    const title = this.newTitle().trim();
    const userId = this.auth.user()?.id;

    if (!title || !userId) {
      return;
    }

    this.errorMessage.set(null);

    const { error } = await supabase.from('tasks').insert({ title, user_id: userId });

    if (error) {
      this.errorMessage.set(error.message);
      return;
    }

    this.newTitle.set('');
    this.tasks.reload();
  }

  protected async toggleTask(task: Task): Promise<void> {
    this.errorMessage.set(null);

    const { error } = await supabase
      .from('tasks')
      .update({ is_done: !task.is_done })
      .eq('id', task.id);

    if (error) {
      this.errorMessage.set(error.message);
      return;
    }

    this.tasks.reload();
  }

  protected async deleteTask(task: Task): Promise<void> {
    this.errorMessage.set(null);

    const { error } = await supabase.from('tasks').delete().eq('id', task.id);

    if (error) {
      this.errorMessage.set(error.message);
      return;
    }

    this.tasks.reload();
  }
}
