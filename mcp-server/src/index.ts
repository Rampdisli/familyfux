import 'dotenv/config';
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  getOAuthProtectedResourceMetadataUrl,
  mcpAuthRouter,
} from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { createClient } from '@supabase/supabase-js';
import { renderLoginPage, SupabaseOAuthProvider } from './oauth-provider.js';

const { SUPABASE_URL, SUPABASE_ANON_KEY, PUBLIC_URL, PORT } = process.env;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !PUBLIC_URL) {
  throw new Error('Missing SUPABASE_URL, SUPABASE_ANON_KEY or PUBLIC_URL in .env');
}

const supabaseUrl: string = SUPABASE_URL;
const supabaseAnonKey: string = SUPABASE_ANON_KEY;
const publicUrl = new URL(PUBLIC_URL);
const mcpUrl = new URL('/mcp', publicUrl);

const logDir = path.join(import.meta.dirname, '..', 'logs');
await mkdir(logDir, { recursive: true });
const logFile = path.join(logDir, 'mcp.log');

/** Logs every MCP/OAuth event to the console and to logs/mcp.log. */
async function logEvent(event: Record<string, unknown>): Promise<void> {
  const line = JSON.stringify({ timestamp: new Date().toISOString(), ...event });
  console.log(line);
  await appendFile(logFile, line + '\n');
}

const authProvider = new SupabaseOAuthProvider(supabaseUrl, supabaseAnonKey);

/**
 * Builds a Supabase client scoped to one signed-in MCP client's own session
 * (via their access token, obtained through the OAuth login), so RLS on
 * `tasks` applies exactly as it would for that user in the Angular app.
 */
function createMcpServer(supabaseAccessToken: string, userId: string): McpServer {
  const server = new McpServer({ name: 'familyfux-tasks', version: '0.0.0' });

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${supabaseAccessToken}` } },
  });

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
        await logEvent({ type: 'tool_call', tool: 'create_task', userId, title, error: error.message });
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to create task: ${error.message}` }],
        };
      }

      await logEvent({ type: 'tool_call', tool: 'create_task', userId, title, taskId: data.id });
      return {
        content: [{ type: 'text', text: `Created task "${data.title}" (id: ${data.id}).` }],
      };
    },
  );

  server.registerTool(
    'list_tasks',
    {
      title: 'List tasks',
      description: 'Lists all tasks in the Familyfux task list.',
      inputSchema: {},
    },
    async () => {
      const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        await logEvent({ type: 'tool_call', tool: 'list_tasks', userId, error: error.message });
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to list tasks: ${error.message}` }],
        };
      }

      await logEvent({ type: 'tool_call', tool: 'list_tasks', userId, count: data.length });

      if (data.length === 0) {
        return { content: [{ type: 'text', text: 'No tasks found.' }] };
      }

      const lines = data.map((task) => `- [${task.is_done ? 'x' : ' '}] ${task.title} (id: ${task.id})`);
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );

  server.registerTool(
    'delete_task',
    {
      title: 'Delete task',
      description: 'Deletes a task from the Familyfux task list by its id.',
      inputSchema: { id: z.string().uuid().describe('The id of the task to delete') },
    },
    async ({ id }) => {
      const { data, error } = await supabase.from('tasks').delete().eq('id', id).select().maybeSingle();

      if (error) {
        await logEvent({ type: 'tool_call', tool: 'delete_task', userId, taskId: id, error: error.message });
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to delete task: ${error.message}` }],
        };
      }

      if (!data) {
        await logEvent({ type: 'tool_call', tool: 'delete_task', userId, taskId: id, notFound: true });
        return {
          isError: true,
          content: [{ type: 'text', text: `No task found with id ${id}.` }],
        };
      }

      await logEvent({ type: 'tool_call', tool: 'delete_task', userId, taskId: id, title: data.title });
      return {
        content: [{ type: 'text', text: `Deleted task "${data.title}" (id: ${id}).` }],
      };
    },
  );

  return server;
}

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Mounts /authorize, /token, /register, /revoke and the OAuth discovery
// well-known endpoints. ChatGPT/Claude discover these automatically from
// the WWW-Authenticate header returned by the protected /mcp endpoint below.
app.use(
  mcpAuthRouter({
    provider: authProvider,
    issuerUrl: publicUrl,
    resourceServerUrl: mcpUrl,
    resourceName: 'Familyfux Tasks',
    scopesSupported: ['tasks:write'],
  }),
);

// Rendered by SupabaseOAuthProvider#authorize(); posts back here to verify
// the Familyfux login before an authorization code is ever issued.
app.post('/login', async (req, res) => {
  const { request_id: requestId, email, password } = req.body ?? {};

  try {
    const redirectUrl = await authProvider.completeLogin(requestId, email, password);
    await logEvent({ type: 'login', email, success: true });
    res.redirect(redirectUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Anmeldung fehlgeschlagen';
    await logEvent({ type: 'login', email, success: false, error: message });
    res.status(401).type('html').send(renderLoginPage(requestId, undefined, message));
  }
});

app.post(
  '/mcp',
  requireBearerAuth({
    verifier: authProvider,
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpUrl),
  }),
  async (req, res) => {
    const { method, id, params } = req.body ?? {};
    const auth = req.auth!;
    const userId = auth.extra?.supabaseUserId as string;
    const supabaseAccessToken = auth.extra?.supabaseAccessToken as string;

    await logEvent({ type: 'request', method, id, params, userId });

    const server = createMcpServer(supabaseAccessToken, userId);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    res.on('close', () => {
      void transport.close();
      void server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  },
);

const port = Number(PORT) || 3000;
app.listen(port, () => {
  console.log(`Familyfux tasks MCP server listening on http://localhost:${port}/mcp`);
  console.log(`Public URL: ${mcpUrl.href}`);
});
