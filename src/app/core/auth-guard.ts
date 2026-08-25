import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Auth } from './auth';

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

  return auth.isAuthenticated() ? router.parseUrl('/dashboard') : true;
};
