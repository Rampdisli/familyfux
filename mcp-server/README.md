# Familyfux Tasks MCP Server

A minimal [MCP](https://modelcontextprotocol.io/) server for the family task pool ("Fuxis Plan")
of the main Familyfux Supabase project:

- `create_task` — new task with optional emoji, colour and reward (stars); one-off or recurring
  (daily, weekly, on certain weekdays, every X days/weeks/months, monthly, yearly, or X days after
  the last completion)
- `list_tasks` — the current pool: every task that is due, with reward, schedule and who claimed it
- `list_family_members` — family members with their stars this week
- `claim_task` — assign a pool entry to a family member, or release it
- `set_task_done` — mark a pool entry as done / open again
- `delete_task` — remove a task from the pool (recurring tasks stop; finished ones stay in the history)

It's a full **OAuth 2.1 authorization server** in front of these tools (using the
`@modelcontextprotocol/sdk`'s built-in auth router): connecting a client (ChatGPT, Claude, ...)
opens a real login screen, checks the email/password against Supabase Auth, and issues that
client its own access token tied to the signed-in user's Supabase session. No credentials are
stored in `.env` or anywhere on disk — RLS on the family tables applies exactly as it does in the
Angular app, scoped to whichever account logged in.

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

Start it:

```bash
npm run dev
```

This serves the MCP endpoint at `http://localhost:3000/mcp` (Streamable HTTP transport) and
the OAuth endpoints (`/authorize`, `/token`, `/register`, `/.well-known/oauth-*`) at the app
root.

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

## Logs

Every OAuth login and MCP request/tool-call is logged to `logs/mcp.log` (one JSON line per
event) and to the console. `tail -f logs/mcp.log` to watch live while testing.
