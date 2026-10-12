# Familyfux

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 21.1.4 and uses:

- **Standalone components**, the 2025 file-naming style guide (`app.ts` instead of `app.component.ts`), and the new `@if`/`@else` control-flow syntax.
- **Zoneless change detection** (no `zone.js`) — `ng new ... --zoneless`.
- **Signals** end to end: app state, forms binding, and Angular's `resource()` API for async data loading.
- **[Supabase](https://supabase.com/)** as the backend (Auth + Postgres) via `@supabase/supabase-js`.

## Supabase setup

1. Create a project at [supabase.com](https://supabase.com/dashboard).
2. Copy the **Project URL** and **anon public key** from *Project Settings → API*.
3. Paste them into `src/environments/environment.ts`, which `ng serve` uses:

   ```ts
   export const environment = {
     production: false,
     supabaseUrl: 'https://xxxxxxxx.supabase.co',
     supabaseAnonKey: 'eyJ...',
   };
   ```

   The production build (`ng build`) does *not* contain these values: `environment.prod.ts`
   reads them from `window.__env`, which the Docker image writes into `config.js` on container
   start from the `SUPABASE_URL` / `SUPABASE_ANON_KEY` env vars — see [Docker](#docker) below.

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

### Demo `tasks` table

The task list (`src/app/features/tasks/task-list`) demonstrates a full CRUD flow (create,
toggle, delete) scoped to the signed-in user via `resource()`. The table is defined as a
migration in `supabase/migrations/20260825000000_create_tasks_table.sql`. Apply it to your
project with the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started):

```bash
supabase login
supabase link --project-ref aenkarrgedrcnqxpakam
supabase db push
```

Or paste the SQL below directly into the *SQL Editor* in the Supabase dashboard:

```sql
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  is_done boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.tasks enable row level security;

create policy "Users can view their own tasks"
  on public.tasks for select
  using (auth.uid() = user_id);

create policy "Users can insert their own tasks"
  on public.tasks for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own tasks"
  on public.tasks for update
  using (auth.uid() = user_id);

create policy "Users can delete their own tasks"
  on public.tasks for delete
  using (auth.uid() = user_id);
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
    tasks/task-list/       # protected page, CRUD demo against `tasks` table
  app.routes.ts            # lazy-loaded routes with guards
```

## Factsheet

`public/factsheet.html` is a standalone promo page for Fuxis Plan (screens from
`design/prototypes/`, images embedded). The build copies it unchanged, so it is served at
`/factsheet.html` (or `<BASE_HREF>/factsheet.html`) as a plain static file — no login needed,
since it never goes through the Angular app or its route guards.

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

## Docker

The app ships as an nginx image that serves the compiled bundle. Run it locally:

```bash
docker compose up --build
```

That publishes it on <http://localhost:8080> (nginx listens on 8080 inside the container, as
a non-root user). `/healthz` returns `ok` for container health checks and reverse proxies.

### Runtime configuration

The image contains no Supabase credentials. On every container start,
`docker/30-familyfux-config.sh` writes `/usr/share/nginx/html/config.js` from two required
env vars, and `index.html` loads that file before the bundle:

| Variable | Required | Example |
| --- | --- | --- |
| `SUPABASE_URL` | yes | `https://aenkarrgedrcnqxpakam.supabase.co` |
| `SUPABASE_ANON_KEY` | yes | `sb_publishable_...` |
| `BASE_HREF` | no, default `/` | `/familyfux` |
| `PORT` | no, default `8080` | `8080` |

`PORT` is the port nginx listens on inside the container. Cloud Run sets it per instance
(see [Google Cloud Run](#google-cloud-run-free-tier)); on the NAS and with docker compose the
default applies. `docker/nginx.conf.template` is rendered with it on every start.

The footer at the bottom of every page shows the bundle's version (`package.json`), commit and
build time. The image build writes them to `version.json` next to the bundle, and the startup
script folds that file into `config.js` as `window.__env.build`. The commit is read from the
checkout's own `.git` (`HEAD` and the refs, which `.dockerignore` and `.gcloudignore` let
through), so it is there whichever way the image is built: the workflow, Cloud Build, or
`gcloud run deploy --source` from a laptop.

If either Supabase variable is missing the container exits at startup with an error instead
of serving a broken app. So the same image can be pointed at a different Supabase project
without a rebuild — and it can stay a public package, since the only values baked in are the
app's own sources.

#### Serving under a sub-path (`BASE_HREF`)

When the app is not at the root of its host — e.g. `https://nas.example/familyfux/` behind
a reverse proxy — set `BASE_HREF` to that path. The startup script then

- rewrites `<base href>` in `index.html`, so Angular's router and all relative asset URLs
  resolve under that prefix, and
- makes nginx strip the prefix from incoming requests (`/familyfux/tasks` → `/tasks`), so
  it works whether the reverse proxy forwards the path as-is or strips it first.

`/familyfux`, `/familyfux/` and a full URL like `https://nas.example/familyfux` are all
accepted; only the path is used. Nothing needs to be rebuilt — the same image serves at `/`
and at any prefix.

For a plain `ng build` outside Docker, pass the prefix at build time instead:

```bash
ng build --base-href /familyfux/
```

### Publishing to GitHub Container Registry

`.github/workflows/publish-app.yml` builds and pushes `ghcr.io/rampdisli/familyfux-app`
for `linux/amd64` + `linux/arm64` on every push to `main` (and on `v*` tags). It authenticates
with the workflow's own `GITHUB_TOKEN`, so no personal access token is involved:

- push to `main` → `:latest` and `:sha-<short>`
- tag `v1.2.3` → additionally `:1.2.3` and `:1.2`

To pull it on the Synology NAS (once, if the package is private):

```bash
docker login ghcr.io -u rampdisli   # PAT with read:packages, entered at the prompt
docker pull ghcr.io/rampdisli/familyfux-app:latest
```

Then create the container from that image in Container Manager with `SUPABASE_URL` and
`SUPABASE_ANON_KEY` set (plus `BASE_HREF` if it sits under a sub-path of the reverse
proxy), mapping a host port to container port **8080**.

Building and pushing by hand instead, without the workflow:

```bash
docker buildx build --platform linux/amd64,linux/arm64 \
  -t ghcr.io/rampdisli/familyfux-app:latest --push .
```

### Google Cloud Run (free tier)

The same image runs on [Cloud Run](https://cloud.google.com/run) without changes: Cloud Run
hands the container a `PORT`, nginx listens on it, and the Supabase values come in as env
vars like everywhere else. For a family-sized app this stays inside the
[always-free tier](https://cloud.google.com/run/pricing) (per month: 2 million requests,
180 000 vCPU-seconds, 360 000 GiB-seconds, 1 GB egress), provided the service

- runs in a **Tier 1 region** — `europe-west1` (Belgium) is the closest one; Frankfurt
  (`europe-west3`) and Zurich (`europe-west6`) are Tier 2 and are billed from the first
  request,
- keeps **request-based billing** (the default: CPU is only allocated while a request is in
  flight) with `--min-instances 0`, so an idle service costs nothing, and
- caps `--max-instances` at `1`, so a traffic spike or a bug cannot fan out.

Google still requires a billing account on the project; a
[budget alert](https://cloud.google.com/billing/docs/how-to/budgets) at a few euros is cheap
insurance.

**Deploys are automatic.** Both Cloud Run services are connected to this GitHub repository
(*Cloud Run → service → Set up continuous deployment*): every push to `main` has Cloud Build
build the `Dockerfile` (app) and `mcp-server/Dockerfile` (MCP server) and roll the new revision
out. Env vars and secrets carry over from the previous revision, so nothing has to be set again.
Cloud Build (2 500 build-minutes/month) and Artifact Registry (0.5 GB) stay inside their free
quotas for this; `.gcloudignore` keeps the source upload down to what the build needs.

The first deploy, or one from a laptop without going through `main`, works by hand too:

```bash
gcloud auth login
gcloud config set project <PROJECT_ID>
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com

gcloud run deploy familyfux \
  --source . \
  --region europe-west1 \
  --allow-unauthenticated \
  --memory 128Mi --cpu 1 \
  --min-instances 0 --max-instances 1 \
  --set-env-vars SUPABASE_URL=https://xxxxxxxx.supabase.co,SUPABASE_ANON_KEY=sb_publishable_...
```

The command prints the service URL (`https://familyfux-<PROJECT_NUMBER>.europe-west1.run.app`,
HTTPS included). Add it to *Authentication → URL Configuration* in the Supabase dashboard so the
auth redirects work. Do **not** set `BASE_HREF`: Cloud Run serves the app at the root of its URL.

The MCP server deploys the same way as a second service, see
[mcp-server/README.md](mcp-server/README.md#deploying-to-google-cloud-run-free-tier).

Each deploy leaves the previous image in Artifact Registry (free up to 0.5 GB, roughly 20
images of this size). A
[cleanup policy](https://cloud.google.com/artifact-registry/docs/repositories/cleanup-policy)
on the `cloud-run-source-deploy` repository, or deleting old images now and then, keeps that
free too.

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
