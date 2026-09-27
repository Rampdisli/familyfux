import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Auth } from './auth';
import { supabase } from './supabase-client';

/** Protects routes that require a signed-in user. */
export const authGuard: CanActivateFn = async () => {
  const auth = inject(Auth);
  const router = inject(Router);

  await auth.ready;

  return auth.isAuthenticated() ? true : router.parseUrl('/login');
};

/** Keeps already signed-in users away from the login/signup page. */
export const guestGuard: CanActivateFn = async () => {
  const auth = inject(Auth);
  const router = inject(Router);

  await auth.ready;

  return auth.isAuthenticated() ? router.parseUrl('/tasks') : true;
};

/** The admin area ("Familie verwalten", creating tasks) is for parents only; everyone else lands on the task pool. */
export const parentGuard: CanActivateFn = async () => {
  const auth = inject(Auth);
  const router = inject(Router);

  await auth.ready;

  const userId = auth.user()?.id;
  if (!userId) {
    return router.parseUrl('/login');
  }

  const { data } = await supabase
    .from('family_members')
    .select('id')
    .eq('user_id', userId)
    .eq('role', 'parent')
    .limit(1);

  return data?.length ? true : router.parseUrl('/tasks');
};
