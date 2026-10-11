# Familyfux Tasks MCP Server

A minimal [MCP](https://modelcontextprotocol.io/) server for the family task pool and recipe
collection ("Fuxis Plan") of the main Familyfux Supabase project:

- `create_task` — new task with optional emoji, colour and reward (stars); one-off or recurring
  (daily, weekly, on certain weekdays, every X days/weeks/months, monthly, yearly, or X days after
  the last completion); when several members do it together, each earns the reward or they split it;
  optionally assigned to family members by name
- `list_tasks` — the current pool: every task that is due, with reward, schedule and who takes part
- `list_family_members` — family members with their balance (all stars ever earned minus rewards
  bought) and their stars this week
- `claim_task` / `leave_task` — a family member joins a pool entry or steps out again
- `set_task_done` — tick off a member's part (joins them first if needed); the entry is done once
  all participants are
- `delete_task` — remove a task from the pool (recurring tasks stop; finished ones stay in the history)

Repeatable tasks ("Immer wieder") show up in `list_tasks` with today's count; `set_task_done` with
their `task_id` counts one more time (or takes the member's latest time today back).

Rewards ("Belohnungen"; answers in short, speakable German):

- `list_rewards` — what family members can buy with their stars: emoji, name, category, price, unit, description,
  purchases in the last 30 days, archived yes/no and id (`include_archived`, `category`)
- `create_reward` — new reward, per purchase or in units; title and price are required (Claude asks
  otherwise), emoji / colour / category get defaults that the answer names; refuses a second active
  reward with the same name and suggests `update_reward`
- `update_reward` — changes only the given fields and answers before → after; `unit_amount: null`
  turns it into a reward per purchase. Purchases already made keep their price
- `archive_reward` / `restore_reward` — out of the shop and back (purchases stay); restoring fails if
  an active reward with the same name exists meanwhile
- `list_open_redemptions` — bought but not redeemed yet, per member, with cost, time and purchase id
- `confirm_redemption` — ticks a purchase off (`purchase_id`, or `member` + `reward`; the oldest open
  one if there are several)

Rewards are found by id or by name (case-insensitive); with several matches Claude asks back. Writing
tools and `confirm_redemption` are for parents only (“Nur Eltern können Belohnungen ändern.”), RLS and
the SQL functions check it again. For example:

- „Leg eine Belohnung an: 10 Minuten Gamezeit für 40 Sterne.“ → `create_reward` with
  `title: "Gamezeit", price: 40, unit_amount: 10, unit_label: "Minuten", category: "screen"`
- „Neue Belohnung Pizza-Abend für 80 Sterne.“ → `create_reward` with `title: "Pizza-Abend", price: 80, category: "food"`
- „Tabletzeit kostet jetzt 25 Sterne.“ → `update_reward` → „📱 Tabletzeit: 20 ⭐ → 25 ⭐ pro 5 Minuten.“
- „Mia hat ihre Tabletzeit eingelöst.“ → `confirm_redemption` with `member: "Mia", reward: "Tabletzeit"`

Recipe import ("Essen"):

- `read_recipe_page` — reads title, ingredients (split into quantity and name) and picture from a
  recipe link (schema.org recipe data, else the page title / preview picture); saves nothing, so
  Claude shows it to the user and lets them change it first
- `save_recipe` — saves the confirmed recipe (`create_recipe`): every ingredient with quantity and
  name, next to the original recipe's, so the app marks what the family changed, added or left out
  (`recipe_ingredients.status`); copies the picture into the Supabase storage bucket
  `recipe-images` (`<family_id>/<random>.<ext>`); refuses duplicates (same link or title) unless asked
- `list_recipes` — the family's recipes with how many ingredients differ from the original, to
  check for duplicates

Pages and pictures are only fetched from public addresses (no private / local networks), with a
10 s timeout, at most 3 MB per page and 5 MB per picture.

It's a full **OAuth 2.1 authorization server** in front of these tools (using the
`@modelcontextprotocol/sdk`'s built-in auth router): connecting a client (ChatGPT, Claude, ...)
opens a real login screen, checks the email/password against Supabase Auth, and issues that
client its own access token tied to the signed-in user's Supabase session. No credentials are
stored in `.env` or anywhere on disk — RLS on the family tables applies exactly as it does in the
Angular app, scoped to whichever account logged in.

The authorization server itself is **stateless**: client ids, login requests, authorization
codes, access and refresh tokens are sealed (AES-256-GCM, keyed from `TOKEN_SECRET`) and carry
their own state, see `src/sealed.ts`. Restarts, redeploys and Cloud Run's scale-to-zero therefore
do not log any connected client out, and several instances can share one secret. Revoking a
token ends its Supabase session at once; the access token itself stays valid until it expires
(at most one hour). Changing `TOKEN_SECRET` invalidates everything and every client reconnects.

## Setup

```bash
cd mcp-server
npm install
cp .env.example .env
```

Fill in `.env`:

- `SUPABASE_URL` / `SUPABASE_ANON_KEY` — same anon key as `src/environments/environment.ts`.
- `PUBLIC_URL` — the public HTTPS URL this server is reachable at (an ngrok tunnel while
  testing, your NAS's domain once deployed there). This becomes the OAuth issuer, so it must
  match exactly what the MCP client connects to.
- `TOKEN_SECRET` — random, at least 32 characters, e.g. `openssl rand -base64 48` (or
  `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"`). Seals the
  OAuth tokens, see above; keep it stable and private.

Start it:

```bash
npm run dev
```

This serves the MCP endpoint at `http://localhost:3000/mcp` (Streamable HTTP transport) and
the OAuth endpoints (`/authorize`, `/token`, `/register`, `/.well-known/oauth-*`) at the app
root.

## Smoke test for the reward tools

`npm run smoke:rewards` plays create → update → archive → restore through a real MCP client against a
**local** Supabase (`supabase start`, all migrations applied) and deletes its test reward again:

```bash
SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=<local anon key> \
SMOKE_EMAIL=<parent account> SMOKE_PASSWORD=<password> npm run smoke:rewards
```

The account must be a parent in a family. It refuses hosted `*.supabase.co` projects.
`npm run typecheck` checks the server and the script.

## Testing with ChatGPT

ChatGPT's MCP connectors only support HTTP(S) servers, not local stdio servers, so a
locally running server needs to be tunneled to a public HTTPS URL to test it there:

```bash
ngrok http 3000
```

Take the `https://xxxx.ngrok-free.app` (or reserved `*.ngrok-free.dev`) URL ngrok prints,
put it into `PUBLIC_URL` in `.env`, and restart the server. In ChatGPT (Developer Mode →
Connectors → Add custom connector) enter `https://xxxx.ngrok-free.app/mcp` as the server URL
with **OAuth** as the authentication method — ChatGPT will register itself as a client, then
redirect you to this server's login page to sign in with your Familyfux account.

**Note:** free ngrok sessions time out after a while and the tunnel URL can change on
restart — if `PUBLIC_URL` and the actual tunnel URL drift apart, the OAuth issuer check will
fail. Re-run `ngrok http 3000`, update `PUBLIC_URL` if the URL changed, and restart the
server.

## Testing with Claude Desktop / Claude Code instead

Since this server only speaks HTTP, add it as a remote MCP server pointing at
`http://localhost:3000/mcp` (no tunnel needed for local-only clients; use `PUBLIC_URL=http://localhost:3000`
for local-only testing, since the issuer check allows plain HTTP for `localhost`).

## Deploying to a Synology NAS

The server is plain Node/Express, so it runs on the NAS exactly as it does locally:

1. Enable **Container Manager** (Docker) on the NAS, or install Node.js directly if your
   model supports it.
2. Copy the `mcp-server/` folder to the NAS, `npm install`, and run `npm start` (a
   `Dockerfile` can be added if you prefer a container).
3. Expose it publicly via **Cloudflare Tunnel** (`cloudflared`, no port-forwarding needed)
   or DSM's built-in **Reverse Proxy + DDNS**.
4. Set `PUBLIC_URL` in `.env` to that permanent public URL instead of an ngrok URL.

## Deploying to Google Cloud Run (free tier)

The same Dockerfile deploys to [Cloud Run](https://cloud.google.com/run) and stays inside the
always-free tier for family use (the same conditions as for the app: a Tier 1 region such as
`europe-west1`, request-based billing with `--min-instances 0`, `--max-instances 1`; see the
[root README](../README.md#google-cloud-run-free-tier)). Because the server is stateless, an
instance that is shut down after idling costs nothing and nobody has to log in again.

Like the app, the service is connected to the GitHub repository: every push to `main` builds
`mcp-server/Dockerfile` and deploys it; env vars and the secret carry over between revisions.
The one-time setup below creates the service, its secret and the env vars by hand.

The service URL is deterministic, so `PUBLIC_URL` can be set on the very first deploy:
`https://<SERVICE>-<PROJECT_NUMBER>.<REGION>.run.app`. The Cloud Run APIs must already be
enabled and the Compute Engine default service account must have the *Cloud Run Builder* role
(both done once for the app). `TOKEN_SECRET` goes into Secret Manager rather than a plain env
var:

```bash
cd mcp-server
PROJECT_NUMBER=$(gcloud projects describe "$(gcloud config get-value project)" --format='value(projectNumber)')

gcloud services enable secretmanager.googleapis.com
openssl rand -base64 48 | gcloud secrets create familyfux-mcp-token-secret --data-file=-
gcloud secrets add-iam-policy-binding familyfux-mcp-token-secret \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

gcloud run deploy familyfux-mcp \
  --source . \
  --region europe-west1 \
  --allow-unauthenticated \
  --memory 256Mi --cpu 1 \
  --min-instances 0 --max-instances 1 \
  --set-secrets "TOKEN_SECRET=familyfux-mcp-token-secret:latest" \
  --set-env-vars "SUPABASE_URL=https://xxxxxxxx.supabase.co,SUPABASE_ANON_KEY=sb_publishable_...,PUBLIC_URL=https://familyfux-mcp-${PROJECT_NUMBER}.europe-west1.run.app,LOG_TO_FILE=false"
```

`--allow-unauthenticated` only opens the HTTP port; every tool call still needs the OAuth
login above. `LOG_TO_FILE=false` because Cloud Run's filesystem is in-memory and stdout already
lands in Cloud Logging. The MCP endpoint for ChatGPT / Claude is then
`https://familyfux-mcp-<PROJECT_NUMBER>.europe-west1.run.app/mcp` with **OAuth** as the
authentication method. New versions arrive with the next push to `main`; the secret stays.

## Logs

Every OAuth login and MCP request/tool-call is logged to `logs/mcp.log` (one JSON line per
event) and to the console. `tail -f logs/mcp.log` to watch live while testing. `LOG_TO_FILE=false`
keeps it on the console only (Cloud Run).
