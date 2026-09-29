import { inject } from '@angular/core';
import { Routes } from '@angular/router';
import { authGuard, guestGuard, parentGuard } from './core/auth-guard';
import { TaskPool } from './features/tasks/task-pool';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'tasks',
  },
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/login/login').then((m) => m.Login),
  },
  {
    path: 'tasks',
    canActivate: [authGuard],
    loadComponent: () => import('./features/tasks/task-list/task-list').then((m) => m.TaskList),
  },
  {
    path: 'tasks/neu',
    canActivate: [authGuard, parentGuard],
    loadComponent: () => import('./features/tasks/task-create/task-create').then((m) => m.TaskCreate),
  },
  {
    path: 'aufgaben',
    canActivate: [authGuard, parentGuard],
    loadComponent: () => import('./features/tasks/task-admin/task-admin').then((m) => m.TaskAdmin),
  },
  {
    path: 'belohnungen',
    canActivate: [authGuard],
    loadComponent: () => import('./features/rewards/reward-shop/reward-shop').then((m) => m.RewardShop),
  },
  {
    path: 'belohnungen/verwalten',
    canActivate: [authGuard, parentGuard],
    loadComponent: () => import('./features/rewards/reward-admin/reward-admin').then((m) => m.RewardAdmin),
  },
  {
    path: 'belohnungen/neu',
    canActivate: [authGuard, parentGuard],
    loadComponent: () => import('./features/rewards/reward-create/reward-create').then((m) => m.RewardCreate),
  },
  {
    path: 'profil',
    canActivate: [authGuard],
    loadComponent: () => import('./features/profile/profile').then((m) => m.Profile),
  },
  {
    // Old progress links: the profile of that member.
    path: 'fortschritt/:memberId',
    redirectTo: ({ params }) => {
      inject(TaskPool).selectMember(params['memberId']);
      return '/profil';
    },
  },
  {
    // The calendar was dropped.
    path: 'kalender',
    redirectTo: 'tasks',
  },
  {
    path: 'essen',
    canActivate: [authGuard],
    loadComponent: () => import('./features/meals/recipes/recipes').then((m) => m.Recipes),
    children: [
      { path: '', children: [] },
      // Recipe details, over the recipe list (which stays as it was underneath).
      {
        path: 'rezept/:id',
        loadComponent: () => import('./features/meals/recipe-detail/recipe-detail').then((m) => m.RecipeDetail),
      },
    ],
  },
  {
    path: 'essen/wochenplan',
    canActivate: [authGuard],
    loadComponent: () => import('./features/meals/week-plan/week-plan').then((m) => m.WeekPlan),
  },
  {
    path: 'essen/neu',
    canActivate: [authGuard],
    loadComponent: () => import('./features/meals/recipe-create/recipe-create').then((m) => m.RecipeCreate),
  },
  {
    // Old link from before "Essen" had recipes and a week plan.
    path: 'essensplan',
    redirectTo: 'essen/wochenplan',
  },
  {
    path: 'familie',
    canActivate: [authGuard, parentGuard],
    loadComponent: () => import('./features/family/family-admin').then((m) => m.FamilyAdmin),
  },
  {
    path: '**',
    redirectTo: '',
  },
];
