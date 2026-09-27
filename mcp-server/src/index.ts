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

/** `tasks.schedule`, see supabase/migrations/20260927200000_task_schedules_and_occurrences.sql. */
const SCHEDULES = [
  'once',
  'daily',
  'weekly',
  'weekdays',
  'every_x_days',
  'monthly',
  'every_x_weeks',
  'every_x_months',
  'yearly',
  'after_completion',
] as const;

type Schedule = (typeof SCHEDULES)[number];

/** Parameters each schedule needs (the DB check enforces the same). */
const REQUIRED_PARAMS: Partial<Record<Schedule, ('repeat_every' | 'weekdays' | 'month_day' | 'month')[]>> = {
  weekly: ['weekdays'],
  weekdays: ['weekdays'],
  every_x_days: ['repeat_every'],
  monthly: ['month_day'],
  every_x_weeks: ['repeat_every', 'weekdays'],
  every_x_months: ['repeat_every', 'month_day'],
  yearly: ['month_day', 'month'],
  after_completion: ['repeat_every'],
};

const WEEKDAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface TaskSchedule {
  schedule: Schedule;
  start_date: string;
  repeat_every: number | null;
  weekdays: number[] | null;
  month_day: number | null;
  month: number | null;
}

/** "every 2 weeks on Wed", "3 days after the last completion", … */
function describeSchedule(t: TaskSchedule): string {
  const days = (t.weekdays ?? []).map((d) => WEEKDAY_NAMES[d - 1]).join(', ');
  switch (t.schedule) {
    case 'once':
      return `once on ${t.start_date}`;
    case 'daily':
      return 'daily';
    case 'weekly':
    case 'weekdays':
      return `weekly on ${days}`;
    case 'every_x_days':
      return `every ${t.repeat_every} days`;
    case 'monthly':
      return `monthly on day ${t.month_day}`;
    case 'every_x_weeks':
      return `every ${t.repeat_every} weeks on ${days}`;
    case 'every_x_months':
      return `every ${t.repeat_every} months on day ${t.month_day}`;
    case 'yearly':
      return `yearly on ${t.month_day}.${t.month}.`;
    case 'after_completion':
      return `${t.repeat_every} days after the last completion`;
  }
}

/** A task's current occurrence in the pool (row of the task_pool view). */
interface PoolRow {
  id: string;
  task_id: string;
  title: string;
  emoji: string;
  reward: number;
  schedule: Schedule;
  due_date: string;
  is_done: boolean;
  claimed_by: string | null;
}

const POOL_COLUMNS = 'id, task_id, title, emoji, reward, schedule, due_date, is_done, claimed_by';

type MemberNames = Map<string, string>;

/** One line per pool entry, e.g. `- [ ] 🧹 Staubsaugen (2 ★, daily, due 2026-09-27, 🦊 Ramona, id: …, task_id: …)`. */
function formatPoolRow(row: PoolRow, members: MemberNames): string {
  const claimer = row.claimed_by ? (members.get(row.claimed_by) ?? 'someone') : 'unclaimed';
  const schedule = row.schedule === 'once' ? 'one-off' : `recurring: ${row.schedule}`;
  return (
    `- [${row.is_done ? 'x' : ' '}] ${row.emoji} ${row.title} ` +
    `(${row.reward} ★, ${schedule}, due ${row.due_date}, ${claimer}, id: ${row.id}, task_id: ${row.task_id})`
  );
}

const authProvider = new SupabaseOAuthProvider(supabaseUrl, supabaseAnonKey);

/**
 * Builds a Supabase client scoped to one signed-in MCP client's own session
 * (via their access token, obtained through the OAuth login), so RLS on
 * the family tables applies exactly as it would for that user in the Angular app.
 */
function createMcpServer(supabaseAccessToken: string, userId: string): McpServer {
  const server = new McpServer(
    { name: 'familyfux-tasks', version: '0.3.0' },
    {
      instructions:
        'Family chore pool ("Fuxis Plan"). Users often talk to you by voice, mostly in German: keep replies ' +
        'and follow-up questions short and speakable, and never invent details they did not give — ask instead.',
    },
  );

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${supabaseAccessToken}` } },
  });

  /** Logs a failed tool call and returns the message as an MCP error result. */
  async function fail(tool: string, text: string, details: Record<string, unknown> = {}) {
    await logEvent({ type: 'tool_call', tool, userId, ...details, error: text });
    return { isError: true, content: [{ type: 'text' as const, text }] };
  }

  /** "🦊 Ramona" per member id, for the pool listings. */
  async function memberNames(): Promise<MemberNames> {
    const { data } = await supabase.from('family_members').select('id, name, emoji');
    return new Map((data ?? []).map((m) => [m.id as string, `${m.emoji} ${m.name}`]));
  }

  server.registerTool(
    'create_task',
    {
      title: 'Create task',
      description:
        "Creates a task in the family's task pool (Fuxis Plan): one-off or recurring. " +
        'Recurring tasks reappear in the pool automatically according to their schedule. ' +
        'Only pass schedule and reward if the user actually said them — do not guess. ' +
        'If something is missing, the tool creates nothing and tells you what to ask the user; ' +
        'ask, then call it again with the answers.',
      inputSchema: {
        title: z.string().min(1).describe('The title of the task'),
        emoji: z.string().min(1).optional().describe('An emoji for the task tile, e.g. 🧹 (default ✅)'),
        color: z.enum(POOL_COLORS).optional().describe('Colour of the task tile (default peach)'),
        reward: z
          .number()
          .int()
          .min(1)
          .max(10)
          .optional()
          .describe('Stars (1–10) earned for doing it. Leave out if the user did not say.'),
        schedule: z
          .enum(SCHEDULES)
          .optional()
          .describe(
            'Leave out if the user did not say whether it is one-off or recurring. ' +
              'once: appears on start_date. daily. weekly: on weekdays[0]. weekdays: on each of weekdays. ' +
              'every_x_days: every repeat_every days from start_date. monthly: on month_day. ' +
              'every_x_weeks: every repeat_every weeks on weekdays[0]. every_x_months: every repeat_every months on month_day. ' +
              'yearly: on month_day of month. after_completion: repeat_every days after it was last done.',
          ),
        start_date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe('YYYY-MM-DD. Day of a one-off task, or when a recurring one starts (default today)'),
        repeat_every: z.number().int().min(1).max(365).optional().describe('Interval for every_x_* and after_completion'),
        weekdays: z
          .array(z.number().int().min(1).max(7))
          .min(1)
          .optional()
          .describe('ISO weekdays, 1 = Monday … 7 = Sunday (weekly / every_x_weeks: exactly one)'),
        month_day: z.number().int().min(1).max(31).optional().describe('Day of month; 29–31 fall on the last day of shorter months'),
        month: z.number().int().min(1).max(12).optional().describe('Month for yearly tasks'),
      },
    },
    async ({ title, emoji, color, reward, schedule, start_date, repeat_every, weekdays, month_day, month }) => {
      const params = { repeat_every, weekdays, month_day, month };

      // Follow-up questions instead of defaults: Claude asks the user (by voice) and calls again.
      const questions: string[] = [];
      if (!schedule) {
        questions.push('Is it a one-off task or a recurring one? If recurring: how often (e.g. daily, every Monday, every 3 days)?');
      } else {
        const missing = (REQUIRED_PARAMS[schedule] ?? []).filter((key) => params[key] === undefined);
        if (missing.length > 0) {
          questions.push(`For "${schedule}" I still need: ${missing.join(', ')} — ask the user (e.g. which weekday / how many days).`);
        }
      }
      if (reward === undefined) {
        questions.push('How many stars (1–10) should it be worth?');
      }

      if (questions.length > 0) {
        await logEvent({ type: 'tool_call', tool: 'create_task', userId, title, followUp: questions });
        return {
          content: [
            {
              type: 'text' as const,
              text:
                `Nothing created yet. Ask the user briefly, in their language, then call create_task again ` +
                `for "${title}" with the answers:\n- ${questions.join('\n- ')}`,
            },
          ],
        };
      }

      // family_id comes from the tasks_before_write trigger, the first occurrence from tasks_after_insert.
      const { data, error } = await supabase
        .from('tasks')
        .insert({ title, emoji, color, reward, schedule, start_date, ...params, user_id: userId })
        .select('id, title, schedule, start_date, repeat_every, weekdays, month_day, month')
        .single<TaskSchedule & { id: string; title: string }>();

      if (error) {
        return fail('create_task', `Failed to create task: ${error.message}`, { title, schedule });
      }

      const { data: current } = await supabase
        .from('task_pool')
        .select(POOL_COLUMNS)
        .eq('task_id', data.id)
        .maybeSingle<PoolRow>();

      await logEvent({ type: 'tool_call', tool: 'create_task', userId, title, schedule, taskId: data.id });
      const pool = current
        ? `It is in the pool now:\n${formatPoolRow(current, await memberNames())}`
        : 'It appears in the pool once it is due.';
      return {
        content: [
          {
            type: 'text',
            text: `Created task "${data.title}" (${describeSchedule(data)}, task_id: ${data.id}). ${pool}`,
          },
        ],
      };
    },
  );

  server.registerTool(
    'list_tasks',
    {
      title: 'List tasks',
      description:
        "Lists the family's task pool: every task that is currently due (open, or finished today) with its reward, " +
        'schedule and who claimed it. Open tasks come first. Use `id` for claim_task / set_task_done, `task_id` for delete_task.',
      inputSchema: {},
    },
    async () => {
      // Adds the occurrences of recurring tasks that became due since the last visit.
      const refresh = await supabase.rpc('refresh_task_pool');
      if (refresh.error) {
        return fail('list_tasks', `Failed to refresh the pool: ${refresh.error.message}`);
      }

      const [pool, members] = await Promise.all([
        supabase
          .from('task_pool')
          .select(POOL_COLUMNS)
          .order('is_done')
          .order('due_date')
          .order('title')
          .returns<PoolRow[]>(),
        memberNames(),
      ]);

      if (pool.error) {
        return fail('list_tasks', `Failed to list tasks: ${pool.error.message}`);
      }

      await logEvent({ type: 'tool_call', tool: 'list_tasks', userId, count: pool.data.length });

      if (pool.data.length === 0) {
        return { content: [{ type: 'text', text: 'The task pool is empty.' }] };
      }

      return { content: [{ type: 'text', text: pool.data.map((row) => formatPoolRow(row, members)).join('\n') }] };
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
        'Assigns a task in the pool to a family member (get their id from list_family_members), ' +
        'or releases it again when member_id is omitted.',
      inputSchema: {
        id: z.string().uuid().describe('The `id` of the pool entry from list_tasks (not the task_id)'),
        member_id: z.string().uuid().optional().describe('The id of the family member taking over the task'),
      },
    },
    // The DB trigger rejects members of other families.
    async ({ id, member_id }) => updateOccurrence('claim_task', id, { claimed_by: member_id ?? null }),
  );

  server.registerTool(
    'set_task_done',
    {
      title: 'Mark task as done',
      description:
        'Marks a task in the pool as done (or as open again with done=false). ' +
        'Done tasks count towards the stars of whoever claimed them.',
      inputSchema: {
        id: z.string().uuid().describe('The `id` of the pool entry from list_tasks (not the task_id)'),
        done: z.boolean().default(true).describe('true = done, false = open again'),
      },
    },
    async ({ id, done }) => updateOccurrence('set_task_done', id, { is_done: done }),
  );

  server.registerTool(
    'delete_task',
    {
      title: 'Delete task',
      description:
        'Removes a task from the pool for good; a recurring task stops repeating. ' +
        "Already finished occurrences stay in the members' progress history.",
      inputSchema: { task_id: z.string().uuid().describe('The `task_id` from list_tasks') },
    },
    async ({ task_id }) => {
      const { data, error } = await supabase
        .from('tasks')
        .update({ archived_at: new Date().toISOString() })
        .eq('id', task_id)
        .is('archived_at', null)
        .select('title')
        .maybeSingle();

      if (error) {
        return fail('delete_task', `Failed to delete task: ${error.message}`, { taskId: task_id });
      }

      if (!data) {
        return fail('delete_task', `No active task found with task_id ${task_id}.`, { taskId: task_id });
      }

      await logEvent({ type: 'tool_call', tool: 'delete_task', userId, taskId: task_id, title: data.title });
      return {
        content: [{ type: 'text', text: `Removed task "${data.title}" from the pool (task_id: ${task_id}).` }],
      };
    },
  );

  /** Claims / ticks off one occurrence; claimed_at / done_at are kept in sync by the DB trigger. */
  async function updateOccurrence(
    tool: string,
    id: string,
    changes: { claimed_by?: string | null; is_done?: boolean },
  ) {
    const { data, error } = await supabase
      .from('task_occurrences')
      .update(changes)
      .eq('id', id)
      .select('id, task_id, due_date, reward, is_done, claimed_by, task:tasks(title, emoji, schedule)')
      .maybeSingle();

    if (error) {
      return fail(tool, `Failed to update task: ${error.message}`, { occurrenceId: id, changes });
    }

    if (!data) {
      return fail(tool, `No task in the pool with id ${id}.`, { occurrenceId: id, changes });
    }

    const { task, ...occurrence } = data as unknown as Omit<PoolRow, 'title' | 'emoji' | 'schedule'> & {
      task: Pick<PoolRow, 'title' | 'emoji' | 'schedule'>;
    };

    await logEvent({ type: 'tool_call', tool, userId, occurrenceId: id, changes });
    return {
      content: [
        { type: 'text' as const, text: `Updated task:\n${formatPoolRow({ ...occurrence, ...task }, await memberNames())}` },
      ],
    };
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
