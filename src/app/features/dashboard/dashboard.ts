import { JsonPipe } from '@angular/common';
import { Component, inject, resource } from '@angular/core';
import { Router } from '@angular/router';
import { Auth } from '../../core/auth';
import { supabase } from '../../core/supabase-client';

@Component({
  selector: 'app-dashboard',
  imports: [JsonPipe],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard {
  protected readonly auth = inject(Auth);
  private readonly router = inject(Router);

  /**
   * Demo usage of Angular's `resource()` API: re-fetches whenever the
   * reactive `params` value changes, and exposes value/error/isLoading
   * signals. Assumes a `profiles` table as described in the README.
   */
  protected readonly profile = resource({
    params: () => ({ userId: this.auth.user()?.id }),
    loader: async ({ params }) => {
      if (!params.userId) {
        return null;
      }

      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', params.userId)
        .maybeSingle();

      if (error) {
        throw error;
      }

      return data;
    },
  });

  protected async signOut(): Promise<void> {
    await this.auth.signOut();
    void this.router.navigateByUrl('/login');
  }
}
