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
import { copyImage, isOwnImage, readRecipePage, RECIPE_IMAGES_BUCKET } from './recipes.js';

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

/** A task's current occurrence in the pool (row of the task_pool view) with its participants. */
interface PoolRow {
  id: string;
  task_id: string;
  title: string;
  emoji: string;
  reward: number;
  /** each: every participant earns the reward; split: they share it. */
  reward_mode: 'each' | 'split';
  schedule: Schedule;
  due_date: string;
  /** All participants are done. */
  is_done: boolean;
  claims: { member_id: string | null; is_done: boolean }[];
}

const POOL_COLUMNS = 'id, task_id, title, emoji, reward, reward_mode, schedule, due_date, is_done';

type MemberNames = Map<string, string>;

/**
 * One line per pool entry, e.g.
 * `- [ ] 🧹 Staubsaugen (2 ★ each, daily, due 2026-09-27, with: 🦊 Mia ✓, 🐻 Ben, id: …, task_id: …)`.
 */
function formatPoolRow(row: PoolRow, members: MemberNames): string {
  const people = row.claims.length
    ? 'with: ' + row.claims.map((c) => `${members.get(c.member_id ?? '') ?? 'former member'}${c.is_done ? ' ✓' : ''}`).join(', ')
    : 'nobody yet';
  const reward = `${row.reward} ★ ${row.reward_mode === 'split' ? 'shared' : 'each'}`;
  const schedule = row.schedule === 'once' ? 'one-off' : `recurring: ${row.schedule}`;
  return (
    `- [${row.is_done ? 'x' : ' '}] ${row.emoji} ${row.title} ` +
    `(${reward}, ${schedule}, due ${row.due_date}, ${people}, id: ${row.id}, task_id: ${row.task_id})`
  );
}

/** A repeatable task ("Immer wieder") with today's completions, oldest first. */
interface RepeatableRow {
  id: string;
  title: string;
  emoji: string;
  reward: number;
  today: { member_id: string | null }[];
}

/** `- 🔁 🐈 Katze füttern (2 ★ per time, 3× today: 🦊 Mia, 🦊 Mia, 🐻 Ben, task_id: …)`. */
function formatRepeatableRow(row: RepeatableRow, members: MemberNames): string {
  const today = row.today.length
    ? `${row.today.length}× today: ${row.today.map((c) => members.get(c.member_id ?? '') ?? 'former member').join(', ')}`
    : 'not done today yet';
  return `- 🔁 ${row.emoji} ${row.title} (${row.reward} ★ per time, ${today}, task_id: ${row.id})`;
}

/** A row of `recipes` as the recipe tools read it. */
interface RecipeRow {
  id: string;
  title: string;
  url: string | null;
  image_url: string | null;
  ingredients: string[];
}

/** Same page, even if one link has a trailing slash or #anchor. */
function sameRecipeUrl(a: string | null, b: string | null): boolean {
  const normalize = (u: string) => u.replace(/#.*$/, '').replace(/\/+$/, '').toLowerCase();
  return !!a && !!b && normalize(a) === normalize(b);
}

const authProvider = new SupabaseOAuthProvider(supabaseUrl, supabaseAnonKey);

/**
 * Builds a Supabase client scoped to one signed-in MCP client's own session
 * (via their access token, obtained through the OAuth login), so RLS on
 * the family tables applies exactly as it would for that user in the Angular app.
 */
function createMcpServer(supabaseAccessToken: string, userId: string): McpServer {
  const server = new McpServer(
    { name: 'familyfux-tasks', version: '0.5.0' },
    {
      instructions:
        'Family chore pool and recipe collection ("Fuxis Plan"). Users often talk to you by voice, mostly in German: keep replies ' +
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

  /** Adds the participants to pool rows. */
  async function withClaims(rows: Omit<PoolRow, 'claims'>[]): Promise<PoolRow[]> {
    if (rows.length === 0) {
      return [];
    }
    const { data } = await supabase
      .from('task_claims')
      .select('occurrence_id, member_id, is_done')
      .in('occurrence_id', rows.map((r) => r.id))
      .order('claimed_at');
    return rows.map((row) => ({
      ...row,
      claims: (data ?? []).filter((c) => c.occurrence_id === row.id),
    }));
  }

  /** Active repeatable tasks with today's completions (family time zone). */
  async function repeatableTasks(taskId?: string) {
    let tasks = supabase
      .from('tasks')
      .select('id, title, emoji, reward')
      .eq('is_repeatable', true)
      .is('archived_at', null)
      .order('title');
    if (taskId) {
      tasks = tasks.eq('id', taskId);
    }
    const [repeatable, today] = await Promise.all([
      tasks.returns<Omit<RepeatableRow, 'today'>[]>(),
      supabase
        .from('task_completions_today')
        .select('task_id, member_id')
        .order('completed_at')
        .returns<{ task_id: string; member_id: string | null }[]>(),
    ]);
    return {
      error: repeatable.error ?? today.error,
      rows: (repeatable.data ?? []).map((t) => ({ ...t, today: (today.data ?? []).filter((c) => c.task_id === t.id) })),
    };
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
        "Creates a task in the family's task pool (Fuxis Plan): one-off, recurring or repeatable. " +
        'Recurring tasks reappear in the pool automatically according to their schedule. ' +
        'Repeatable tasks ("Immer wieder", e.g. feeding the cat) are always there and can be done any number of ' +
        'times a day; every time, the member who did it earns the stars. ' +
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
          .max(100)
          .optional()
          .describe('Stars (1–100) earned for doing it. Leave out if the user did not say.'),
        assign_to: z
          .array(z.string().min(1))
          .optional()
          .describe(
            'Optional: family members (names or ids) the task is assigned to; they take part in every occurrence. ' +
              'Leave out if the user did not name anyone — then whoever wants picks it up from the pool.',
          ),
        reward_mode: z
          .enum(['each', 'split'])
          .default('each')
          .describe('When several members do it together: each earns the full reward, or they split it (default each)'),
        repeatable: z
          .boolean()
          .optional()
          .describe(
            'true for a task that comes up several times a day and can be ticked off any number of times ' +
              '(no schedule needed then; assign_to and reward_mode do not apply).',
          ),
        schedule: z
          .enum(SCHEDULES)
          .optional()
          .describe(
            'Leave out if the user did not say whether it is one-off or recurring, or for repeatable tasks. ' +
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
    async ({ title, emoji, color, reward, reward_mode, assign_to, repeatable, schedule, start_date, repeat_every, weekdays, month_day, month }) => {
      const params = { repeat_every, weekdays, month_day, month };

      // Follow-up questions instead of defaults: Claude asks the user (by voice) and calls again.
      const questions: string[] = [];
      if (repeatable) {
        // Always there, no schedule; done by one member at a time.
        schedule = undefined;
        assign_to = undefined;
        reward_mode = 'each';
      } else if (!schedule) {
        questions.push('Is it a one-off task or a recurring one? If recurring: how often (e.g. daily, every Monday, every 3 days)?');
      } else {
        const missing = (REQUIRED_PARAMS[schedule] ?? []).filter((key) => params[key] === undefined);
        if (missing.length > 0) {
          questions.push(`For "${schedule}" I still need: ${missing.join(', ')} — ask the user (e.g. which weekday / how many days).`);
        }
      }
      if (reward === undefined) {
        questions.push('How many stars (1–100) should it be worth?');
      }

      // Names (as spoken) or ids → member ids; unknown names become a question.
      let assignees: { id: string; name: string }[] = [];
      if (assign_to?.length) {
        const { data: family } = await supabase.from('family_members').select('id, name');
        const members = family ?? [];
        const unknown: string[] = [];
        for (const who of assign_to) {
          const match = members.find((m) => m.id === who || m.name.toLowerCase() === who.trim().toLowerCase());
          if (match) {
            assignees.push(match);
          } else {
            unknown.push(who);
          }
        }
        assignees = [...new Map(assignees.map((m) => [m.id, m])).values()];
        if (unknown.length) {
          questions.push(
            `Who is meant by ${unknown.map((u) => `"${u}"`).join(', ')}? Family members: ${members.map((m) => m.name).join(', ')}.`,
          );
        }
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
        .insert({
          title,
          emoji,
          color,
          reward,
          reward_mode,
          is_repeatable: repeatable ?? false,
          ...(repeatable ? {} : { schedule, start_date, ...params }),
          user_id: userId,
        })
        .select('id, title, schedule, start_date, repeat_every, weekdays, month_day, month')
        .single<TaskSchedule & { id: string; title: string }>();

      if (error) {
        return fail('create_task', `Failed to create task: ${error.message}`, { title, schedule });
      }

      if (repeatable) {
        await logEvent({ type: 'tool_call', tool: 'create_task', userId, title, repeatable, taskId: data.id });
        return {
          content: [
            {
              type: 'text',
              text:
                `Created repeatable task "${data.title}" (task_id: ${data.id}). It is always in the "Immer wieder" ` +
                'section and can be ticked off any number of times a day with set_task_done (id = task_id).',
            },
          ],
        };
      }

      // Assignees join the task's open occurrence right away (DB trigger).
      if (assignees.length) {
        const assigned = await supabase
          .from('task_assignees')
          .insert(assignees.map((m) => ({ task_id: data.id, member_id: m.id })));
        if (assigned.error) {
          return fail('create_task', `Created the task, but assigning failed: ${assigned.error.message}`, {
            title,
            taskId: data.id,
          });
        }
      }

      const { data: current } = await supabase
        .from('task_pool')
        .select(POOL_COLUMNS)
        .eq('task_id', data.id)
        .maybeSingle<Omit<PoolRow, 'claims'>>();
      const [currentRow] = current ? await withClaims([current]) : [];

      await logEvent({ type: 'tool_call', tool: 'create_task', userId, title, schedule, taskId: data.id });
      const pool = currentRow
        ? `It is in the pool now:\n${formatPoolRow(currentRow, await memberNames())}`
        : 'It appears in the pool once it is due.';
      const assignedText = assignees.length ? ` Assigned to ${assignees.map((m) => m.name).join(', ')}.` : '';
      return {
        content: [
          {
            type: 'text',
            text: `Created task "${data.title}" (${describeSchedule(data)}, task_id: ${data.id}).${assignedText} ${pool}`,
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
        'schedule and who takes part (✓ = their part is done). Several members can do a task together; ' +
        'it is done once all of them are. Open tasks come first. ' +
        'Below them, the repeatable tasks ("Immer wieder", 🔁): always there, done any number of times a day, ' +
        'with how often and by whom they were done today. ' +
        'Use `id` for claim_task / leave_task / set_task_done, `task_id` for delete_task; ' +
        'for repeatable tasks pass their `task_id` to set_task_done.',
      inputSchema: {},
    },
    async () => {
      // Adds the occurrences of recurring tasks that became due since the last visit.
      const refresh = await supabase.rpc('refresh_task_pool');
      if (refresh.error) {
        return fail('list_tasks', `Failed to refresh the pool: ${refresh.error.message}`);
      }

      const [pool, repeatable, members] = await Promise.all([
        supabase
          .from('task_pool')
          .select(POOL_COLUMNS)
          .order('is_done')
          .order('due_date')
          .order('title')
          .returns<Omit<PoolRow, 'claims'>[]>(),
        repeatableTasks(),
        memberNames(),
      ]);

      const error = pool.error ?? repeatable.error;
      if (error) {
        return fail('list_tasks', `Failed to list tasks: ${error.message}`);
      }

      await logEvent({
        type: 'tool_call',
        tool: 'list_tasks',
        userId,
        count: pool.data?.length ?? 0,
        repeatable: repeatable.rows.length,
      });

      const rows = await withClaims(pool.data ?? []);
      const sections = [
        rows.length ? rows.map((row) => formatPoolRow(row, members)).join('\n') : 'The task pool is empty.',
      ];
      if (repeatable.rows.length) {
        sections.push(
          'Repeatable ("Immer wieder"):\n' + repeatable.rows.map((row) => formatRepeatableRow(row, members)).join('\n'),
        );
      }
      return { content: [{ type: 'text', text: sections.join('\n\n') }] };
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
        supabase.from('member_week_stars').select('member_id, stars').returns<{ member_id: string; stars: number | string }[]>(),
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

      // numeric: shared tasks give fractional stars (1.5).
      const starsByMember = new Map((stars.data ?? []).map((s) => [s.member_id, Number(s.stars)]));
      const lines = family.map(
        (m) => `- ${m.emoji} ${m.name} (${m.role}, ${starsByMember.get(m.id) ?? 0} ★ this week, id: ${m.id})`,
      );
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );

  server.registerTool(
    'claim_task',
    {
      title: 'Take part in a task',
      description:
        'Adds a family member (id from list_family_members) as participant of a pool entry. ' +
        'Several members can take part; each ticks off their own part with set_task_done.',
      inputSchema: {
        id: z.string().uuid().describe('The `id` of the pool entry from list_tasks (not the task_id)'),
        member_id: z.string().uuid().describe('The family member taking part'),
      },
    },
    async ({ id, member_id }) => {
      // The DB trigger rejects members of other families.
      const { error } = await supabase.from('task_claims').insert({ occurrence_id: id, member_id });
      if (error) {
        const text = error.code === '23505' ? 'This member already takes part.' : `Failed to claim task: ${error.message}`;
        return fail('claim_task', text, { occurrenceId: id, memberId: member_id });
      }
      return reportEntry('claim_task', id, { memberId: member_id });
    },
  );

  server.registerTool(
    'leave_task',
    {
      title: 'Step out of a task',
      description: "Removes a participant from a pool entry again (only while their part isn't done).",
      inputSchema: {
        id: z.string().uuid().describe('The `id` of the pool entry from list_tasks (not the task_id)'),
        member_id: z.string().uuid().describe('The family member stepping out'),
      },
    },
    async ({ id, member_id }) => {
      const { data, error } = await supabase
        .from('task_claims')
        .delete()
        .eq('occurrence_id', id)
        .eq('member_id', member_id)
        .select('id');

      if (error) {
        return fail('leave_task', `Failed to leave task: ${error.message}`, { occurrenceId: id, memberId: member_id });
      }
      if (!data.length) {
        return fail('leave_task', 'This member does not take part, or their part is already done.', {
          occurrenceId: id,
          memberId: member_id,
        });
      }
      return reportEntry('leave_task', id, { memberId: member_id });
    },
  );

  server.registerTool(
    'set_task_done',
    {
      title: 'Mark task as done',
      description:
        "Ticks off a member's part of a pool entry (or opens it again with done=false). " +
        'If the member does not take part yet, they are added — so "Mia brushed her teeth" is a single call. ' +
        'The entry is done once all participants are; each earns the full reward or a share, depending on the task. ' +
        'Repeatable tasks (🔁, pass their task_id): every call with done=true counts one more time for the member ' +
        "and earns them the stars; done=false takes back that member's latest time today (a mistake).",
      inputSchema: {
        id: z
          .string()
          .uuid()
          .describe('The `id` of the pool entry from list_tasks (not the task_id) — or the `task_id` of a repeatable task'),
        member_id: z.string().uuid().describe('The family member who did it'),
        done: z.boolean().default(true).describe('true = done, false = open again / take back'),
      },
    },
    async ({ id, member_id, done }) => {
      const { data: repeatable } = await supabase
        .from('tasks')
        .select('id')
        .eq('id', id)
        .eq('is_repeatable', true)
        .maybeSingle();
      if (repeatable) {
        return completeRepeatable(id, member_id, done);
      }

      const updated = await supabase
        .from('task_claims')
        .update({ is_done: done })
        .eq('occurrence_id', id)
        .eq('member_id', member_id)
        .select('id');

      if (updated.error) {
        return fail('set_task_done', `Failed to update task: ${updated.error.message}`, { occurrenceId: id, memberId: member_id });
      }

      if (!updated.data.length) {
        if (!done) {
          return fail('set_task_done', 'This member does not take part in the task.', { occurrenceId: id, memberId: member_id });
        }
        // Not a participant yet: join and finish in one go.
        const inserted = await supabase.from('task_claims').insert({ occurrence_id: id, member_id, is_done: true });
        if (inserted.error) {
          return fail('set_task_done', `Failed to update task: ${inserted.error.message}`, {
            occurrenceId: id,
            memberId: member_id,
          });
        }
      }

      return reportEntry('set_task_done', id, { memberId: member_id, done });
    },
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

  /** One more time (done) or the member's latest time today taken back (not done) of a repeatable task. */
  async function completeRepeatable(taskId: string, memberId: string, done: boolean) {
    const details = { taskId, memberId, done };

    if (done) {
      // The DB trigger rejects archived tasks and members of other families.
      const { error } = await supabase.from('task_completions').insert({ task_id: taskId, member_id: memberId });
      if (error) {
        return fail('set_task_done', `Failed to tick off the task: ${error.message}`, details);
      }
    } else {
      const { data: latest } = await supabase
        .from('task_completions_today')
        .select('id')
        .eq('task_id', taskId)
        .eq('member_id', memberId)
        .order('completed_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!latest) {
        return fail('set_task_done', 'This member has not done the task today.', details);
      }
      const { error } = await supabase.from('task_completions').delete().eq('id', latest.id);
      if (error) {
        return fail('set_task_done', `Failed to take it back: ${error.message}`, details);
      }
    }

    await logEvent({ type: 'tool_call', tool: 'set_task_done', userId, ...details });
    const { rows } = await repeatableTasks(taskId);
    return {
      content: [
        {
          type: 'text' as const,
          text: rows.length ? `Updated task:\n${formatRepeatableRow(rows[0], await memberNames())}` : 'Done.',
        },
      ],
    };
  }

  /** The family the signed-in user belongs to (recipes are stored per family). */
  async function ownFamilyId(): Promise<string | null> {
    const { data } = await supabase
      .from('family_members')
      .select('family_id')
      .eq('user_id', userId)
      .order('created_at')
      .limit(1)
      .maybeSingle();
    return (data?.family_id as string | undefined) ?? null;
  }

  async function familyRecipes() {
    return supabase
      .from('recipes')
      .select('id, title, url, image_url, ingredients')
      .order('title')
      .returns<RecipeRow[]>();
  }

  server.registerTool(
    'read_recipe_page',
    {
      title: 'Read recipe page',
      description:
        'Step 1 of importing a recipe from a link (Fooby, Cookidoo or any recipe site): reads its title, ingredients ' +
        'and picture. Saves nothing. Then show the user what was found — title, the ingredients as a list, whether ' +
        'there is a picture — and let them change it: rename, add, remove or replace ingredients, drop the picture. ' +
        'Recipe pages are messy, so never save without their okay; call save_recipe only after they confirm.',
      inputSchema: {
        url: z.string().url().describe('Link to the recipe page'),
      },
    },
    async ({ url }) => {
      let draft;
      try {
        draft = await readRecipePage(url);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return fail('read_recipe_page', `Could not read the page: ${message} Ask the user for the recipe details instead.`, {
          url,
        });
      }

      const recipes = await familyRecipes();
      const duplicate = (recipes.data ?? []).find(
        (r) => sameRecipeUrl(r.url, draft.url) || sameRecipeUrl(r.url, url),
      );

      const missing = [
        !draft.title && 'title',
        draft.ingredients.length === 0 && 'ingredients',
        !draft.image_url && 'picture',
      ].filter(Boolean);

      await logEvent({ type: 'tool_call', tool: 'read_recipe_page', userId, url, source: draft.source, missing });

      const lines = [
        `Found on ${draft.url}${draft.source === 'page' ? ' (no structured recipe data — only the page title / preview picture)' : ''}:`,
        `Title: ${draft.title ?? '(none found)'}`,
        draft.ingredients.length
          ? `Ingredients (${draft.ingredients.length}):\n${draft.ingredients.map((i) => `- ${i}`).join('\n')}`
          : 'Ingredients: (none found)',
        `Picture: ${draft.image_url ?? '(none found)'}`,
      ];
      if (missing.length) {
        lines.push(`Missing: ${missing.join(', ')} — ask the user to fill in what they want, or save without it.`);
      }
      if (duplicate) {
        lines.push(`Note: this link is already saved as "${duplicate.title}" (id: ${duplicate.id}). Tell the user before saving it again.`);
      }
      lines.push(
        'Nothing saved yet. Show this to the user, apply their changes, and call save_recipe with the final values once they confirm.',
      );
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );

  server.registerTool(
    'save_recipe',
    {
      title: 'Save recipe',
      description:
        "Step 2: saves a recipe to the family's recipe collection (page \"Essen\" in the app) — only after the user " +
        'confirmed title, ingredients and picture (see read_recipe_page), including any changes they made. ' +
        'The picture is copied into the family\'s own storage so it stays even if the recipe site changes. ' +
        'Refuses a recipe whose link or title is already saved unless allow_duplicate is true.',
      inputSchema: {
        title: z.string().trim().min(1).describe('Recipe title as confirmed by the user'),
        ingredients: z
          .array(z.string().trim().min(1))
          .default([])
          .describe('Ingredients as confirmed by the user, one entry per line, e.g. "200 g Spaghetti"'),
        url: z.string().url().optional().describe('Link to the recipe page (leave out for own recipes)'),
        image_url: z
          .string()
          .url()
          .optional()
          .describe('Picture to copy into our storage (from read_recipe_page); leave out for no picture'),
        ingredients_available: z
          .boolean()
          .default(true)
          .describe('Whether the ingredients are in the house (default true, as in the app)'),
        allow_duplicate: z
          .boolean()
          .default(false)
          .describe('true only if the user wants it saved although the same link or title already exists'),
      },
    },
    async ({ title, ingredients, url, image_url, ingredients_available, allow_duplicate }) => {
      const details = { title, url };

      const familyId = await ownFamilyId();
      if (!familyId) {
        return fail('save_recipe', 'You are not a member of any family.', details);
      }

      if (!allow_duplicate) {
        const recipes = await familyRecipes();
        if (recipes.error) {
          return fail('save_recipe', `Failed to check existing recipes: ${recipes.error.message}`, details);
        }
        const duplicate = recipes.data.find(
          (r) => sameRecipeUrl(r.url, url ?? null) || r.title.trim().toLowerCase() === title.toLowerCase(),
        );
        if (duplicate) {
          await logEvent({ type: 'tool_call', tool: 'save_recipe', userId, ...details, duplicateOf: duplicate.id });
          return {
            content: [
              {
                type: 'text' as const,
                text:
                  `Not saved: "${duplicate.title}" is already in the recipes (id: ${duplicate.id}${duplicate.url ? `, ${duplicate.url}` : ''}). ` +
                  'Ask the user whether to save it anyway (then call again with allow_duplicate: true).',
              },
            ],
          };
        }
      }

      // Copy the picture; if that fails the recipe is still saved, just without one.
      let storedImage: { publicUrl: string; path: string } | null = null;
      let imageNote = '';
      if (image_url && isOwnImage(image_url, supabaseUrl)) {
        storedImage = { publicUrl: image_url, path: '' };
      } else if (image_url) {
        try {
          storedImage = await copyImage(supabase, familyId, image_url);
        } catch (error) {
          imageNote = ` The picture could not be copied (${error instanceof Error ? error.message : String(error)}), so it was saved without one.`;
        }
      }

      const { data, error } = await supabase
        .from('recipes')
        .insert({
          family_id: familyId,
          title,
          url: url ?? null,
          image_url: storedImage?.publicUrl ?? null,
          ingredients,
          ingredients_available,
        })
        .select('id')
        .single();

      if (error) {
        if (storedImage?.path) {
          await supabase.storage.from(RECIPE_IMAGES_BUCKET).remove([storedImage.path]);
        }
        return fail('save_recipe', `Failed to save the recipe: ${error.message}`, details);
      }

      await logEvent({
        type: 'tool_call',
        tool: 'save_recipe',
        userId,
        ...details,
        recipeId: data.id,
        image: storedImage?.path || null,
        imageError: imageNote || undefined,
      });
      return {
        content: [
          {
            type: 'text',
            text:
              `Saved recipe "${title}" with ${ingredients.length} ingredient${ingredients.length === 1 ? '' : 's'}` +
              `${storedImage ? ' and its picture' : ''} (id: ${data.id}). It is on the "Essen" page now.${imageNote}`,
          },
        ],
      };
    },
  );

  server.registerTool(
    'list_recipes',
    {
      title: 'List recipes',
      description:
        "Lists the family's saved recipes (title, link, number of ingredients, picture yes/no). " +
        'Use it to check whether a recipe is already there before importing it.',
      inputSchema: {
        query: z.string().trim().min(1).optional().describe('Only recipes whose title contains this text'),
      },
    },
    async ({ query }) => {
      const recipes = await familyRecipes();
      if (recipes.error) {
        return fail('list_recipes', `Failed to list recipes: ${recipes.error.message}`);
      }

      const rows = query
        ? recipes.data.filter((r) => r.title.toLowerCase().includes(query.toLowerCase()))
        : recipes.data;
      await logEvent({ type: 'tool_call', tool: 'list_recipes', userId, query, count: rows.length });

      if (rows.length === 0) {
        return { content: [{ type: 'text', text: query ? `No recipe matches "${query}".` : 'No recipes saved yet.' }] };
      }
      const lines = rows.map(
        (r) =>
          `- ${r.title} (${r.ingredients.length} ingredients${r.image_url ? ', with picture' : ''}` +
          `${r.url ? `, ${r.url}` : ''}, id: ${r.id})`,
      );
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );

  /** Logs a successful claim change and answers with the entry's current state. */
  async function reportEntry(tool: string, id: string, details: Record<string, unknown>) {
    await logEvent({ type: 'tool_call', tool, userId, occurrenceId: id, ...details });

    const { data } = await supabase.from('task_pool').select(POOL_COLUMNS).eq('id', id).maybeSingle<Omit<PoolRow, 'claims'>>();
    if (!data) {
      return { content: [{ type: 'text' as const, text: 'Done. (The entry is no longer in the current pool.)' }] };
    }

    const [row] = await withClaims([data]);
    return { content: [{ type: 'text' as const, text: `Updated task:\n${formatPoolRow(row, await memberNames())}` }] };
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
