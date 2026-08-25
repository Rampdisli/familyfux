# Familyfux

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 21.1.4 and uses:

- **Standalone components**, the 2025 file-naming style guide (`app.ts` instead of `app.component.ts`), and the new `@if`/`@else` control-flow syntax.
- **Zoneless change detection** (no `zone.js`) — `ng new ... --zoneless`.
- **Signals** end to end: app state, forms binding, and Angular's `resource()` API for async data loading.
- **[Supabase](https://supabase.com/)** as the backend (Auth + Postgres) via `@supabase/supabase-js`.

## Supabase setup

1. Create a project at [supabase.com](https://supabase.com/dashboard).
2. Copy the **Project URL** and **anon public key** from *Project Settings → API*.
3. Paste them into `src/environments/environment.ts` (used by `ng serve`) and `src/environments/environment.prod.ts` (used by `ng build`):

   ```ts
   export const environment = {
     production: false,
     supabaseUrl: 'https://xxxxxxxx.supabase.co',
     supabaseAnonKey: 'eyJ...',
   };
   ```

   The anon key is safe to ship to the client — it's designed to be public and access is enforced by [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security) policies on your tables, not by keeping the key secret.

4. By default new users can sign up with email/password (see `src/app/features/auth/login`). To disable "Confirm email" during local testing, go to *Authentication → Providers → Email* in the Supabase dashboard.

### Demo `profiles` table

The dashboard (`src/app/features/dashboard`) demonstrates fetching a row scoped to the signed-in user via `resource()`. Create the table with:

```sql
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users can view their own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- Automatically create a profile row whenever a new user signs up.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
```

### App structure

```
src/app/
  core/
    supabase-client.ts   # shared Supabase client singleton
    auth.ts              # signal-based auth state + sign in/up/out
    auth-guard.ts         # authGuard / guestGuard functional route guards
  features/
    auth/login/           # sign in + sign up form
    dashboard/             # protected page, demoes resource()
  app.routes.ts            # lazy-loaded routes with guards
```

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Vitest](https://vitest.dev/) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
