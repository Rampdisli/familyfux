# Familyfux Tasks MCP Server

A minimal [MCP](https://modelcontextprotocol.io/) server exposing one tool, `create_task`,
that inserts a row into the `tasks` table of the main Familyfux Supabase project.

It authenticates to Supabase with the **anon key + a signed-in user session** (not the
service role key), so the existing Row Level Security policies on `tasks` still apply:
this server can only ever read/write the tasks belonging to the one account it signs in as.

## Setup

```bash
cd mcp-server
npm install
cp .env.example .env
```

Fill in `.env`:

- `SUPABASE_URL` / `SUPABASE_ANON_KEY` — same anon key as `src/environments/environment.ts`.
- `FAMILYFUX_EMAIL` / `FAMILYFUX_PASSWORD` — login of the Familyfux account tasks should be
  created for. Used once at startup to sign in; the client then refreshes the session
  automatically in the background for as long as the process keeps running.

Start it:

```bash
npm run dev
```

This serves the MCP endpoint at `http://localhost:3000/mcp` (Streamable HTTP transport).

## Testing with ChatGPT

ChatGPT's MCP connectors only support HTTP(S) servers, not local stdio servers, so a
locally running server needs to be tunneled to a public HTTPS URL to test it there:

```bash
brew install ngrok
ngrok http 3000
```

Take the `https://xxxx.ngrok-free.app` URL ngrok prints, and in ChatGPT (Developer Mode →
Connectors → Add custom connector) enter `https://xxxx.ngrok-free.app/mcp` as the server
URL, with no authentication.

**Security note:** while the tunnel is open, anyone with that URL can call `create_task`
as your Familyfux account (there's no auth in front of the `/mcp` endpoint itself — the
ngrok URL is the only thing keeping it private). Stop `ngrok` (and the server) once you're
done testing, and don't share the tunnel URL.

## Testing with Claude Desktop / Claude Code instead

Since this server only speaks HTTP, add it as a remote MCP server pointing at
`http://localhost:3000/mcp` (no ngrok needed for local-only clients).
