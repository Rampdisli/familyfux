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

/** Tile colours of the task pool, same as in the Angular app (`PoolColor`). */
const POOL_COLORS = ['mint', 'lilac', 'sky', 'rose', 'peach', 'lemon'] as const;

/** Task columns plus the family member who claimed it (via the claimed_by foreign key). */
const TASK_COLUMNS = 'id, title, emoji, color, reward, is_done, claimed_by, claimer:family_members(name, emoji)';

interface TaskRow {
  id: string;
  title: string;
  emoji: string;
  color: (typeof POOL_COLORS)[number];
  reward: number;
  is_done: boolean;
  claimed_by: string | null;
  claimer: { name: string; emoji: string } | null;
}

/** One line per task, e.g. `- [ ] 🧹 Staubsaugen (2 ★, 🦊 Ramona, id: …)`. */
function formatTask(task: TaskRow): string {
  const claimer = task.claimer ? `, ${task.claimer.emoji} ${task.claimer.name}` : ', unclaimed';
  return `- [${task.is_done ? 'x' : ' '}] ${task.emoji} ${task.title} (${task.reward} ★${claimer}, id: ${task.id})`;
}

const authProvider = new SupabaseOAuthProvider(supabaseUrl, supabaseAnonKey);

/**
 * Builds a Supabase client scoped to one signed-in MCP client's own session
 * (via their access token, obtained through the OAuth login), so RLS on
 * the family tables applies exactly as it would for that user in the Angular app.
 */
function createMcpServer(supabaseAccessToken: string, userId: string): McpServer {
  const server = new McpServer({ name: 'familyfux-tasks', version: '0.2.0' });

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${supabaseAccessToken}` } },
  });

  /** Logs a failed tool call and returns the message as an MCP error result. */
  async function fail(tool: string, text: string, details: Record<string, unknown> = {}) {
    await logEvent({ type: 'tool_call', tool, userId, ...details, error: text });
    return { isError: true, content: [{ type: 'text' as const, text }] };
  }

  server.registerTool(
    'create_task',
    {
      title: 'Create task',
      description: "Creates a new task in the family's task pool (Fuxis Plan).",
      inputSchema: {
        title: z.string().min(1).describe('The title of the task'),
        emoji: z.string().min(1).optional().describe('An emoji for the task tile, e.g. 🧹 (default ✅)'),
        color: z.enum(POOL_COLORS).optional().describe('Colour of the task tile (default peach)'),
        reward: z.number().int().positive().optional().describe('Stars earned for doing it (default 1)'),
      },
    },
    async ({ title, emoji, color, reward }) => {
      // family_id is filled by the tasks_before_write trigger from the user's family.
      const { data, error } = await supabase
        .from('tasks')
        .insert({ title, emoji, color, reward, user_id: userId })
        .select(TASK_COLUMNS)
        .single<TaskRow>();

      if (error) {
        return fail('create_task', `Failed to create task: ${error.message}`, { title });
      }

      await logEvent({ type: 'tool_call', tool: 'create_task', userId, title, taskId: data.id });
      return { content: [{ type: 'text', text: `Created task:\n${formatTask(data)}` }] };
    },
  );

  server.registerTool(
    'list_tasks',
    {
      title: 'List tasks',
      description:
        "Lists all tasks in the family's task pool with their reward and who claimed them. Open tasks come first.",
      inputSchema: {},
    },
    async () => {
      const { data, error } = await supabase
        .from('tasks')
        .select(TASK_COLUMNS)
        .order('is_done')
        .order('created_at')
        .returns<TaskRow[]>();

      if (error) {
        return fail('list_tasks', `Failed to list tasks: ${error.message}`);
      }

      await logEvent({ type: 'tool_call', tool: 'list_tasks', userId, count: data.length });

      if (data.length === 0) {
        return { content: [{ type: 'text', text: 'No tasks found.' }] };
      }

      return { content: [{ type: 'text', text: data.map(formatTask).join('\n') }] };
    },
  );

  server.registerTool(
    'list_family_members',
    {
      title: 'List family members',
      description: 'Lists the members of the family with the stars they earned this week, and their ids for claim_task.',
      inputSchema: {},
    },
    async () => {
      const [members, stars] = await Promise.all([
        supabase
          .from('family_members')
          .select('id, name, emoji, role')
          .order('sort_order')
          .order('created_at')
          .returns<{ id: string; name: string; emoji: string; role: string }[]>(),
        supabase.from('member_week_stars').select('member_id, stars').returns<{ member_id: string; stars: number }[]>(),
      ]);

      const error = members.error ?? stars.error;
      if (error) {
        return fail('list_family_members', `Failed to list family members: ${error.message}`);
      }

      const family = members.data ?? [];

      await logEvent({ type: 'tool_call', tool: 'list_family_members', userId, count: family.length });

      if (family.length === 0) {
        return { content: [{ type: 'text', text: 'You are not a member of any family.' }] };
      }

      const starsByMember = new Map((stars.data ?? []).map((s) => [s.member_id, s.stars]));
      const lines = family.map(
        (m) => `- ${m.emoji} ${m.name} (${m.role}, ${starsByMember.get(m.id) ?? 0} ★ this week, id: ${m.id})`,
      );
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );

  server.registerTool(
    'claim_task',
    {
      title: 'Claim task',
      description:
        'Assigns a task to a family member (get their id from list_family_members), or releases it again when member_id is omitted.',
      inputSchema: {
        id: z.string().uuid().describe('The id of the task'),
        member_id: z.string().uuid().optional().describe('The id of the family member taking over the task'),
      },
    },
    async ({ id, member_id }) => {
      if (member_id) {
        // RLS only returns members of the user's own family.
        const { data: member, error } = await supabase
          .from('family_members')
          .select('id')
          .eq('id', member_id)
          .maybeSingle();

        if (error || !member) {
          const text = error
            ? `Failed to claim task: ${error.message}`
            : `No family member found with id ${member_id}.`;
          return fail('claim_task', text, { taskId: id, memberId: member_id });
        }
      }

      return updateTask('claim_task', id, { claimed_by: member_id ?? null });
    },
  );

  server.registerTool(
    'set_task_done',
    {
      title: 'Mark task as done',
      description: 'Marks a task as done (or as open again with done=false). Done tasks count towards the stars of whoever claimed them.',
      inputSchema: {
        id: z.string().uuid().describe('The id of the task'),
        done: z.boolean().default(true).describe('true = done, false = open again'),
      },
    },
    async ({ id, done }) => updateTask('set_task_done', id, { is_done: done }),
  );

  server.registerTool(
    'delete_task',
    {
      title: 'Delete task',
      description: "Deletes a task from the family's task pool by its id.",
      inputSchema: { id: z.string().uuid().describe('The id of the task to delete') },
    },
    async ({ id }) => {
      const { data, error } = await supabase.from('tasks').delete().eq('id', id).select().maybeSingle();

      if (error) {
        return fail('delete_task', `Failed to delete task: ${error.message}`, { taskId: id });
      }

      if (!data) {
        return fail('delete_task', `No task found with id ${id}.`, { taskId: id });
      }

      await logEvent({ type: 'tool_call', tool: 'delete_task', userId, taskId: id, title: data.title });
      return {
        content: [{ type: 'text', text: `Deleted task "${data.title}" (id: ${id}).` }],
      };
    },
  );

  /** Applies `changes` to one task; claimed_at / done_at are kept in sync by the DB trigger. */
  async function updateTask(tool: string, id: string, changes: { claimed_by?: string | null; is_done?: boolean }) {
    const { data, error } = await supabase
      .from('tasks')
      .update(changes)
      .eq('id', id)
      .select(TASK_COLUMNS)
      .maybeSingle<TaskRow>();

    if (error) {
      return fail(tool, `Failed to update task: ${error.message}`, { taskId: id, changes });
    }

    if (!data) {
      return fail(tool, `No task found with id ${id}.`, { taskId: id, changes });
    }

    await logEvent({ type: 'tool_call', tool, userId, taskId: id, changes });
    return { content: [{ type: 'text' as const, text: `Updated task:\n${formatTask(data)}` }] };
  }

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
