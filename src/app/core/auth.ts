import { Injectable, computed, signal } from '@angular/core';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from './supabase-client';

@Injectable({ providedIn: 'root' })
export class Auth {
  private readonly _session = signal<Session | null>(null);

  /** Current Supabase session, or `null` when signed out. */
  readonly session = this._session.asReadonly();

  /** Convenience signal derived from the session. */
  readonly user = computed<User | null>(() => this._session()?.user ?? null);

  /** Whether a user is currently signed in. */
  readonly isAuthenticated = computed(() => this._session() !== null);

  /**
   * Resolves once the session has been restored from storage on app start.
   * Guards should `await` this before making a redirect decision, otherwise
   * a signed-in user could briefly be bounced to `/login` on page reload.
   */
  readonly ready: Promise<void>;

  constructor() {
    this.ready = supabase.auth.getSession().then(({ data }) => {
      this._session.set(data.session);
    });

    supabase.auth.onAuthStateChange((_event, session) => {
      this._session.set(session);
    });
  }

  signInWithPassword(email: string, password: string) {
    return supabase.auth.signInWithPassword({ email, password });
  }

  signUp(email: string, password: string) {
    return supabase.auth.signUp({ email, password });
  }

  signOut() {
    return supabase.auth.signOut();
  }
}
