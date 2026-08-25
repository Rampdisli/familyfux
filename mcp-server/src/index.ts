import 'dotenv/config';
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createClient } from '@supabase/supabase-js';

const logDir = path.join(import.meta.dirname, '..', 'logs');
await mkdir(logDir, { recursive: true });
const logFile = path.join(logDir, 'mcp.log');

/** Logs every MCP request/response to the console and to logs/mcp.log. */
async function logEvent(event: Record<string, unknown>): Promise<void> {
  const line = JSON.stringify({ timestamp: new Date().toISOString(), ...event });
  console.log(line);
  await appendFile(logFile, line + '\n');
}

const { SUPABASE_URL, SUPABASE_ANON_KEY, FAMILYFUX_EMAIL, FAMILYFUX_PASSWORD, PORT } = process.env;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !FAMILYFUX_EMAIL || !FAMILYFUX_PASSWORD) {
  throw new Error(
    'Missing SUPABASE_URL, SUPABASE_ANON_KEY, FAMILYFUX_EMAIL or FAMILYFUX_PASSWORD in .env',
  );
}

/**
 * Uses the anon key, not the service role key: signing in below keeps the
 * client scoped to this one user, so the `tasks` RLS policies still apply
 * and this server can never see or touch other users' rows.
 */
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: true, persistSession: false },
});

const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
  email: FAMILYFUX_EMAIL,
  password: FAMILYFUX_PASSWORD,
});

if (signInError || !signInData.user) {
  throw new Error(`Supabase sign-in failed: ${signInError?.message}`);
}

const userId = signInData.user.id;
console.log(`Signed in to Supabase as ${signInData.user.email} (${userId})`);

function createMcpServer(): McpServer {
  const server = new McpServer({ name: 'familyfux-tasks', version: '0.0.0' });

  server.registerTool(
    'create_task',
    {
      title: 'Create task',
      description: 'Creates a new task in the Familyfux task list.',
      inputSchema: { title: z.string().min(1).describe('The title of the task') },
    },
    async ({ title }) => {
      const { data, error } = await supabase
        .from('tasks')
        .insert({ title, user_id: userId })
        .select()
        .single();

      if (error) {
        await logEvent({ type: 'tool_call', tool: 'create_task', title, error: error.message });
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to create task: ${error.message}` }],
        };
      }

      await logEvent({ type: 'tool_call', tool: 'create_task', title, taskId: data.id });
      return {
        content: [{ type: 'text', text: `Created task "${data.title}" (id: ${data.id}).` }],
      };
    },
  );

  return server;
}

const app = express();
app.use(express.json());

app.post('/mcp', async (req, res) => {
  const { method, id, params } = req.body ?? {};
  await logEvent({ type: 'request', method, id, params, ip: req.ip });

  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  res.on('close', () => {
    void transport.close();
    void server.close();
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

const port = Number(PORT) || 3000;
app.listen(port, () => {
  console.log(`Familyfux tasks MCP server listening on http://localhost:${port}/mcp`);
});
