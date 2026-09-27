import { Routes } from '@angular/router';
import { authGuard, guestGuard, parentGuard } from './core/auth-guard';

const comingSoon = () => import('./features/coming-soon/coming-soon').then((m) => m.ComingSoon);

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
    path: 'fortschritt/:memberId',
    canActivate: [authGuard],
    loadComponent: () => import('./features/progress/progress').then((m) => m.Progress),
  },
  {
    path: 'kalender',
    canActivate: [authGuard],
    loadComponent: comingSoon,
    data: { icon: '📅', title: 'Kalender', text: 'Gemeinsame Familientermine — noch nicht ausgebaut.' },
  },
  {
    path: 'einkaufen',
    canActivate: [authGuard],
    loadComponent: comingSoon,
    data: { icon: '🛒', title: 'Einkaufsliste', text: 'Was im Haus fehlt — noch nicht ausgebaut.' },
  },
  {
    path: 'essensplan',
    canActivate: [authGuard],
    loadComponent: comingSoon,
    data: { icon: '🍝', title: 'Essensplan', text: 'Wochenplan fürs Kochen — noch nicht ausgebaut.' },
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
