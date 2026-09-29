import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Reward tools ("Belohnungen"): parents manage what kids can buy with their
 * stars, and tick purchases off once they're redeemed. See
 * design/belohnungen-profil.md (section 7) and
 * supabase/migrations/20260929150000_rewards.sql.
 *
 * Answers are short, German and speakable. RLS and the SQL functions check
 * everything again; the parent check here only gives a clear message.
 */

const COLORS = ['mint', 'lilac', 'sky', 'rose', 'peach', 'lemon'] as const;
const CATEGORIES = ['screen', 'food', 'fun'] as const;
type Category = (typeof CATEGORIES)[number];

const CATEGORY_LABELS: Record<Category, string> = { screen: 'Bildschirm', food: 'Essen', fun: 'Erlebnisse' };
/** Emoji when none is given: by category. */
const CATEGORY_EMOJI: Record<Category, string> = { screen: '📱', food: '🍨', fun: '🎁' };
const DEFAULT_COLOR = 'peach';
const DEFAULT_CATEGORY: Category = 'fun';
const DEFAULT_MAX_QUANTITY = 6;

const PARENTS_ONLY = 'Nur Eltern können Belohnungen ändern.';

interface RewardRow {
  id: string;
  family_id: string;
  title: string;
  emoji: string;
  color: string;
  category: Category;
  price: number;
  unit_amount: number | null;
  unit_label: string | null;
  description: string | null;
  max_quantity: number;
  is_active: boolean;
}

interface PurchaseRow {
  id: string;
  member_id: string | null;
  reward_id: string | null;
  title: string;
  emoji: string;
  label: string;
  quantity: number;
  cost: number;
  purchased_at: string;
  redeemed_at: string | null;
}

interface MemberRow {
  id: string;
  family_id: string;
  user_id: string | null;
  name: string;
  emoji: string;
  role: 'parent' | 'child';
}

const REWARD_COLUMNS =
  'id, family_id, title, emoji, color, category, price, unit_amount, unit_label, description, max_quantity, is_active';
const PURCHASE_COLUMNS = 'id, member_id, reward_id, title, emoji, label, quantity, cost, purchased_at, redeemed_at';

/** "Folge" → "Folgen" for more than one; "Minuten" stays (same rule as the app). */
export function pluralUnit(label: string, count: number): string {
  return count === 1 ? label : /e$/.test(label) ? `${label}n` : label;
}

type Unit = Pick<RewardRow, 'unit_amount' | 'unit_label'>;

function amountText(r: Unit, quantity = 1): string {
  const total = (r.unit_amount ?? 0) * quantity;
  return `${total} ${pluralUnit(r.unit_label ?? '', total)}`;
}

/** "10 Minuten für 40 ⭐, bis 6× pro Kauf" / "80 ⭐ pro Kauf (beim Abendessen)". */
export function describeOffer(r: Unit & Pick<RewardRow, 'price' | 'max_quantity' | 'description'>): string {
  if (r.unit_amount) {
    return `${amountText(r)} für ${r.price} ⭐${r.max_quantity > 1 ? `, bis ${r.max_quantity}× pro Kauf` : ''}`;
  }
  return `${r.price} ⭐ pro Kauf${r.description ? ` (${r.description})` : ''}`;
}

/** "🎮 Gamezeit — 10 Minuten für 40 ⭐, bis 6× pro Kauf". */
export function describeReward(r: RewardRow): string {
  return `${r.emoji} ${r.title} — ${describeOffer(r)}`;
}

/** "20 ⭐ pro 5 Minuten" / "25 ⭐ pro Kauf". */
function priceText(r: Unit & Pick<RewardRow, 'price'>): string {
  return `${r.price} ⭐ pro ${r.unit_amount ? amountText(r) : 'Kauf'}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** "heute 14:10", "gestern 17:45", "25.09. 10:20" in the family's time zone. */
function when(iso: string, timeZone: string): string {
  const day = (d: Date) => d.toLocaleDateString('de-CH', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const date = new Date(iso);
  const time = date.toLocaleTimeString('de-CH', { timeZone, hour: '2-digit', minute: '2-digit' });
  const today = new Date();
  const yesterday = new Date(today.getTime() - 24 * 3600e3);
  if (day(date) === day(today)) return `heute ${time}`;
  if (day(date) === day(yesterday)) return `gestern ${time}`;
  return `${date.toLocaleDateString('de-CH', { timeZone, day: '2-digit', month: '2-digit' })}. ${time}`;
}

type Log = (event: Record<string, unknown>) => Promise<void>;

type Found<T> = { ok: true; value: T } | { ok: false; text: string };

/** Fields of create_reward (all optional for update_reward). */
const REWARD_FIELDS = {
  emoji: z.string().min(1).max(16).optional().describe('Emoji for the tile, e.g. 🎮 (default by category: screen 📱, food 🍨, fun 🎁)'),
  color: z.enum(COLORS).optional().describe('Tile colour (default peach)'),
  category: z.enum(CATEGORIES).optional().describe('screen (Bildschirm), food (Essen) or fun (Erlebnisse, default)'),
  max_quantity: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .describe('Only with units: how many units can be bought at once (1–10, default 6)'),
  description: z
    .string()
    .trim()
    .max(40)
    .optional()
    .describe('Only without units: short note, e.g. "beim Abendessen" (max 40 characters)'),
};

export function registerRewardTools(server: McpServer, supabase: SupabaseClient, userId: string, logEvent: Log): void {
  const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });

  async function fail(tool: string, message: string, details: Record<string, unknown> = {}) {
    await logEvent({ type: 'tool_call', tool, userId, ...details, error: message });
    return { isError: true, content: [{ type: 'text' as const, text: message }] };
  }

  /** The signed-in account's family member entry. */
  async function me(): Promise<MemberRow | null> {
    const { data } = await supabase
      .from('family_members')
      .select('id, family_id, user_id, name, emoji, role')
      .eq('user_id', userId)
      .order('created_at')
      .limit(1)
      .returns<MemberRow[]>();
    return data?.[0] ?? null;
  }

  /** The caller, if they're a parent; otherwise the error text. */
  async function parent(): Promise<Found<MemberRow>> {
    const member = await me();
    if (!member) return { ok: false, text: 'Du gehörst zu keiner Familie.' };
    if (member.role !== 'parent') return { ok: false, text: PARENTS_ONLY };
    return { ok: true, value: member };
  }

  async function rewards(): Promise<RewardRow[]> {
    const { data, error } = await supabase
      .from('rewards')
      .select(REWARD_COLUMNS)
      .order('sort_order')
      .order('title')
      .returns<RewardRow[]>();
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  /**
   * A reward by id or name (case-insensitive). With several of the same name
   * (an active and archived ones), `prefer` picks; still several → a question.
   */
  async function findReward(ref: string, prefer: 'active' | 'archived' = 'active'): Promise<Found<RewardRow>> {
    const all = await rewards();
    let matches = UUID.test(ref.trim()) ? all.filter((r) => r.id === ref.trim()) : all.filter((r) => sameName(r.title, ref));
    if (matches.length > 1) {
      const preferred = matches.filter((r) => r.is_active === (prefer === 'active'));
      if (preferred.length) matches = preferred;
    }
    if (matches.length === 1) return { ok: true, value: matches[0] };
    if (matches.length === 0) {
      const names = all.filter((r) => r.is_active).map((r) => r.title);
      return {
        ok: false,
        text: `Keine Belohnung „${ref}“ gefunden.${names.length ? ` Es gibt: ${names.join(', ')}.` : ''} Frag nach, welche gemeint ist.`,
      };
    }
    return {
      ok: false,
      text:
        `Mehrere Belohnungen heißen „${ref}“ — frag nach, welche gemeint ist, und ruf das Tool mit der ID auf:\n` +
        matches.map((r) => `- ${describeReward(r)}${r.is_active ? '' : ' (archiviert)'}, id: ${r.id}`).join('\n'),
    };
  }

  async function family(): Promise<MemberRow[]> {
    const { data } = await supabase
      .from('family_members')
      .select('id, family_id, user_id, name, emoji, role')
      .order('sort_order')
      .order('created_at')
      .returns<MemberRow[]>();
    return data ?? [];
  }

  function findMember(members: MemberRow[], ref: string): Found<MemberRow> {
    const match = members.find((m) => m.id === ref.trim() || sameName(m.name, ref));
    return match
      ? { ok: true, value: match }
      : { ok: false, text: `Wer ist mit „${ref}“ gemeint? In der Familie: ${members.map((m) => m.name).join(', ')}.` };
  }

  async function timeZone(familyId: string | undefined): Promise<string> {
    const { data } = familyId
      ? await supabase.from('families').select('timezone').eq('id', familyId).maybeSingle<{ timezone: string }>()
      : { data: null };
    return data?.timezone ?? 'Europe/Zurich';
  }

  /** A unique active name, or the error text (for create and restore). */
  function nameTaken(all: RewardRow[], title: string, exceptId?: string): RewardRow | undefined {
    return all.find((r) => r.is_active && r.id !== exceptId && sameName(r.title, title));
  }

  // ---------------------------------------------------------------------------

  server.registerTool(
    'list_rewards',
    {
      title: 'List rewards',
      description:
        'Lists the rewards kids can buy with their stars ("Belohnungen"): emoji, name, category, price, unit, ' +
        'description, purchases in the last 30 days, archived yes/no and id. Every family member may use it.',
      inputSchema: {
        include_archived: z.boolean().default(false).describe('Also list archived rewards (default false)'),
        category: z.enum(CATEGORIES).optional().describe('Only this category'),
      },
    },
    async ({ include_archived, category }) => {
      let all: RewardRow[];
      try {
        all = await rewards();
      } catch (error) {
        return fail('list_rewards', `Konnte die Belohnungen nicht laden: ${(error as Error).message}`);
      }

      const since = new Date(Date.now() - 30 * 24 * 3600e3).toISOString();
      const { data: recent } = await supabase
        .from('reward_purchases')
        .select('reward_id')
        .gte('purchased_at', since)
        .returns<{ reward_id: string | null }[]>();
      const counts = new Map<string, number>();
      for (const p of recent ?? []) {
        if (p.reward_id) counts.set(p.reward_id, (counts.get(p.reward_id) ?? 0) + 1);
      }

      const rows = all.filter((r) => (include_archived || r.is_active) && (!category || r.category === category));
      await logEvent({ type: 'tool_call', tool: 'list_rewards', userId, count: rows.length });

      if (rows.length === 0) {
        return text(include_archived || category ? 'Keine passenden Belohnungen.' : 'Es gibt noch keine Belohnungen.');
      }
      const lines = rows.map((r) => {
        const unit = r.unit_amount ? `pro ${amountText(r)}, bis ${r.max_quantity}×` : 'pro Kauf';
        return (
          `- ${r.emoji} ${r.title} (${CATEGORY_LABELS[r.category]}, ${r.price} ⭐ ${unit}` +
          `${r.description ? `, „${r.description}“` : ''}, ${counts.get(r.id) ?? 0}× eingelöst in 30 Tagen` +
          `${r.is_active ? '' : ', archiviert'}, id: ${r.id})`
        );
      });
      return text(lines.join('\n'));
    },
  );

  server.registerTool(
    'create_reward',
    {
      title: 'Create reward',
      description:
        'Parents only. Adds a reward kids can buy with stars, per purchase ("Pizza-Abend für 80 Sterne") or in units ' +
        '("10 Minuten Gamezeit für 40 Sterne": unit_amount 10, unit_label "Minuten", price 40 per unit). ' +
        'Title and price are required — if the user did not say them, ask; never guess. ' +
        'Emoji, colour and category get defaults when missing; the answer names them.',
      inputSchema: {
        title: z.string().trim().min(1).max(40).describe('Name, e.g. "Gamezeit" (1–40 characters)'),
        price: z.number().int().min(1).max(999).describe('Stars per unit, or per purchase without units (1–999)'),
        unit_amount: z.number().int().min(1).max(999).optional().describe('Units per step, e.g. 10 (together with unit_label)'),
        unit_label: z.string().trim().min(1).max(20).optional().describe('e.g. "Minuten", "Folge" (together with unit_amount)'),
        ...REWARD_FIELDS,
      },
    },
    async (input) => {
      const who = await parent();
      if (!who.ok) return fail('create_reward', who.text);

      if ((input.unit_amount === undefined) !== (input.unit_label === undefined)) {
        return fail(
          'create_reward',
          'Für eine Belohnung in Einheiten brauche ich Menge und Einheit zusammen (z. B. 10 und „Minuten“). Frag nach.',
        );
      }
      const units = input.unit_amount !== undefined;
      if (units && input.description) {
        return fail('create_reward', 'Eine Beschreibung gibt es nur bei Belohnungen ohne Einheiten.');
      }
      if (!units && input.max_quantity !== undefined && input.max_quantity !== 1) {
        return fail('create_reward', '„Höchstens pro Kauf“ gibt es nur bei Belohnungen in Einheiten.');
      }

      let all: RewardRow[];
      try {
        all = await rewards();
      } catch (error) {
        return fail('create_reward', `Konnte die Belohnungen nicht laden: ${(error as Error).message}`);
      }
      const taken = nameTaken(all, input.title);
      if (taken) {
        return fail(
          'create_reward',
          `Es gibt schon „${describeReward(taken)}“. Soll ich sie mit update_reward ändern?`,
          { title: input.title },
        );
      }

      const defaults: string[] = [];
      const category = input.category ?? (defaults.push(`Kategorie ${CATEGORY_LABELS[DEFAULT_CATEGORY]}`), DEFAULT_CATEGORY);
      const emoji = input.emoji ?? (defaults.push(`Symbol ${CATEGORY_EMOJI[category]}`), CATEGORY_EMOJI[category]);
      const color = input.color ?? (defaults.push(`Farbe ${DEFAULT_COLOR}`), DEFAULT_COLOR);

      const { data, error } = await supabase
        .from('rewards')
        .insert({
          family_id: who.value.family_id,
          title: input.title,
          emoji,
          color,
          category,
          price: input.price,
          unit_amount: units ? input.unit_amount : null,
          unit_label: units ? input.unit_label : null,
          description: units ? null : input.description || null,
          max_quantity: units ? (input.max_quantity ?? DEFAULT_MAX_QUANTITY) : 1,
          sort_order: all.length,
        })
        .select(REWARD_COLUMNS)
        .single<RewardRow>();

      if (error) {
        const message =
          error.code === '23505'
            ? `Es gibt schon eine aktive Belohnung „${input.title}“. Soll ich sie mit update_reward ändern?`
            : `Konnte die Belohnung nicht speichern: ${error.message}`;
        return fail('create_reward', message, { title: input.title });
      }

      await logEvent({ type: 'tool_call', tool: 'create_reward', userId, rewardId: data.id });
      return text(
        `Gespeichert: ${describeReward(data)}.` + (defaults.length ? ` Gewählt: ${defaults.join(', ')}.` : '') + ` (id: ${data.id})`,
      );
    },
  );

  server.registerTool(
    'update_reward',
    {
      title: 'Update reward',
      description:
        'Parents only. Changes a reward (by id or name); only the given fields change. ' +
        'unit_amount: null turns a reward in units into one per purchase. ' +
        'Purchases already made keep their price.',
      inputSchema: {
        reward: z.string().trim().min(1).describe('Id or name of the reward'),
        title: z.string().trim().min(1).max(40).optional().describe('New name'),
        price: z.number().int().min(1).max(999).optional().describe('New price in stars (per unit, or per purchase)'),
        unit_amount: z
          .number()
          .int()
          .min(1)
          .max(999)
          .nullable()
          .optional()
          .describe('Units per step; null = per purchase from now on'),
        unit_label: z.string().trim().min(1).max(20).optional().describe('e.g. "Minuten", "Folge"'),
        ...REWARD_FIELDS,
      },
    },
    async ({ reward: ref, ...changes }) => {
      const who = await parent();
      if (!who.ok) return fail('update_reward', who.text);

      const found = await findReward(ref);
      if (!found.ok) return fail('update_reward', found.text, { reward: ref });
      const before = found.value;

      // The reward after the change, checked like the form in the app.
      const after: RewardRow = { ...before };
      for (const key of ['title', 'price', 'emoji', 'color', 'category', 'unit_label', 'max_quantity'] as const) {
        if (changes[key] !== undefined) (after as unknown as Record<string, unknown>)[key] = changes[key];
      }
      if (changes.unit_amount === null) {
        Object.assign(after, { unit_amount: null, unit_label: null, max_quantity: 1 });
        if (changes.unit_label !== undefined || (changes.max_quantity ?? 1) !== 1) {
          return fail('update_reward', 'Ohne Einheiten gibt es weder Einheit noch „Höchstens pro Kauf“.');
        }
      } else if (changes.unit_amount !== undefined) {
        after.unit_amount = changes.unit_amount;
        if (!before.unit_amount) {
          // Per purchase → in units: needs a unit; the description goes away.
          after.description = null;
          after.max_quantity = changes.max_quantity ?? DEFAULT_MAX_QUANTITY;
          if (!after.unit_label) {
            return fail('update_reward', 'Welche Einheit ist gemeint (z. B. „Minuten“)? Frag nach.');
          }
        }
      } else if (!before.unit_amount && (changes.unit_label !== undefined || (changes.max_quantity ?? 1) !== 1)) {
        return fail('update_reward', `„${before.title}“ ist pro Kauf. Für Einheiten brauche ich auch unit_amount.`);
      }
      if (changes.description !== undefined) {
        if (after.unit_amount) {
          return fail('update_reward', 'Eine Beschreibung gibt es nur bei Belohnungen ohne Einheiten.');
        }
        after.description = changes.description || null;
      }

      if (after.is_active && changes.title !== undefined) {
        const taken = nameTaken(await rewards(), after.title, before.id);
        if (taken) {
          return fail('update_reward', `Es gibt schon eine aktive Belohnung „${taken.title}“.`);
        }
      }

      const { id, family_id, is_active, ...update } = after;
      const { error } = await supabase.from('rewards').update(update).eq('id', before.id);
      if (error) {
        return fail('update_reward', `Konnte die Belohnung nicht speichern: ${error.message}`, { rewardId: before.id });
      }

      // "Tabletzeit: 20 ⭐ → 25 ⭐ pro 5 Minuten."
      const diff: string[] = [];
      if (after.title !== before.title) diff.push(`Name ${before.title} → ${after.title}`);
      const modeChanged = !before.unit_amount !== !after.unit_amount;
      if (after.price !== before.price || after.unit_amount !== before.unit_amount || after.unit_label !== before.unit_label) {
        diff.push(
          after.unit_amount === before.unit_amount && after.unit_label === before.unit_label
            ? `${before.price} ⭐ → ${priceText(after)}`
            : `${priceText(before)} → ${priceText(after)}` +
                (modeChanged && after.max_quantity > 1 ? `, bis ${after.max_quantity}× pro Kauf` : ''),
        );
      }
      if (after.max_quantity !== before.max_quantity && before.unit_amount && after.unit_amount) {
        diff.push(`bis ${before.max_quantity}× → bis ${after.max_quantity}× pro Kauf`);
      }
      if (after.description !== before.description && !after.unit_amount) {
        diff.push(after.description ? `Beschreibung „${after.description}“` : 'ohne Beschreibung');
      }
      if (after.category !== before.category) {
        diff.push(`Kategorie ${CATEGORY_LABELS[before.category]} → ${CATEGORY_LABELS[after.category]}`);
      }
      if (after.emoji !== before.emoji) diff.push(`Symbol ${before.emoji} → ${after.emoji}`);
      if (after.color !== before.color) diff.push(`Farbe ${before.color} → ${after.color}`);

      await logEvent({ type: 'tool_call', tool: 'update_reward', userId, rewardId: before.id });
      if (!diff.length) {
        return text(`Nichts geändert: ${describeReward(after)}.`);
      }
      return text(
        `${after.emoji} ${after.title}: ${diff.join(', ')}.` +
          (after.price !== before.price ? ' Bereits gekaufte Belohnungen behalten ihren Preis.' : ''),
      );
    },
  );

  for (const archive of [true, false]) {
    const tool = archive ? 'archive_reward' : 'restore_reward';
    server.registerTool(
      tool,
      {
        title: archive ? 'Archive reward' : 'Restore reward',
        description: archive
          ? 'Parents only. Takes a reward (by id or name) out of the shop. Purchases and history stay; restore_reward brings it back.'
          : 'Parents only. Brings an archived reward (by id or name) back into the shop. ' +
            'Fails if an active reward with the same name exists meanwhile.',
        inputSchema: { reward: z.string().trim().min(1).describe('Id or name of the reward') },
      },
      async ({ reward: ref }) => {
        const who = await parent();
        if (!who.ok) return fail(tool, who.text);

        const found = await findReward(ref, archive ? 'active' : 'archived');
        if (!found.ok) return fail(tool, found.text, { reward: ref });
        const r = found.value;

        if (r.is_active === !archive) {
          return text(`${r.emoji} ${r.title} ist schon ${archive ? 'archiviert' : 'im Shop'}.`);
        }
        if (!archive) {
          const taken = nameTaken(await rewards(), r.title, r.id);
          if (taken) {
            return fail(tool, `Es gibt inzwischen wieder eine aktive Belohnung „${taken.title}“. Erst umbenennen oder archivieren.`);
          }
        }

        const { error } = await supabase.from('rewards').update({ is_active: !archive }).eq('id', r.id);
        if (error) {
          const message =
            error.code === '23505'
              ? `Es gibt inzwischen wieder eine aktive Belohnung „${r.title}“.`
              : `Konnte die Belohnung nicht ${archive ? 'archivieren' : 'wiederherstellen'}: ${error.message}`;
          return fail(tool, message, { rewardId: r.id });
        }

        await logEvent({ type: 'tool_call', tool, userId, rewardId: r.id });
        return text(
          archive
            ? `Archiviert: ${r.emoji} ${r.title}. Sie ist nicht mehr im Shop; Käufe und Verlauf bleiben.`
            : `Wieder im Shop: ${describeReward({ ...r, is_active: true })}.`,
        );
      },
    );
  }

  /** Open purchases, oldest first, optionally of one member. */
  async function openPurchases(memberId?: string): Promise<PurchaseRow[]> {
    let query = supabase
      .from('reward_purchases')
      .select(PURCHASE_COLUMNS)
      .is('redeemed_at', null)
      .order('purchased_at');
    if (memberId) query = query.eq('member_id', memberId);
    const { data, error } = await query.returns<PurchaseRow[]>();
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  function purchaseLine(p: PurchaseRow, tz: string): string {
    return `${p.label} (−${p.cost} ⭐, ${when(p.purchased_at, tz)})`;
  }

  server.registerTool(
    'list_open_redemptions',
    {
      title: 'List open redemptions',
      description:
        'Lists rewards kids bought that a parent has not ticked off as redeemed yet, per kid, with amount, cost, ' +
        'when and the purchase id (for confirm_redemption). Every family member may use it.',
      inputSchema: {
        member: z.string().trim().min(1).optional().describe('Only this family member (id or name)'),
      },
    },
    async ({ member }) => {
      const members = await family();
      let memberId: string | undefined;
      if (member) {
        const found = findMember(members, member);
        if (!found.ok) return fail('list_open_redemptions', found.text);
        memberId = found.value.id;
      }

      let open: PurchaseRow[];
      try {
        open = await openPurchases(memberId);
      } catch (error) {
        return fail('list_open_redemptions', `Konnte die Käufe nicht laden: ${(error as Error).message}`);
      }
      await logEvent({ type: 'tool_call', tool: 'list_open_redemptions', userId, count: open.length });

      if (open.length === 0) {
        return text(member ? `${member} hat keine offenen Belohnungen.` : 'Keine offenen Belohnungen.');
      }
      const tz = await timeZone(members[0]?.family_id);
      const lines = members
        .map((m) => ({ m, own: open.filter((p) => p.member_id === m.id) }))
        .filter(({ own }) => own.length)
        .map(({ m, own }) => `${m.emoji} ${m.name}: ${own.map((p) => `${purchaseLine(p, tz)} [id: ${p.id}]`).join('; ')}`);
      const orphans = open.filter((p) => !members.some((m) => m.id === p.member_id));
      if (orphans.length) {
        lines.push(`Ehemalige Mitglieder: ${orphans.map((p) => `${purchaseLine(p, tz)} [id: ${p.id}]`).join('; ')}`);
      }
      return text(lines.join('\n'));
    },
  );

  server.registerTool(
    'confirm_redemption',
    {
      title: 'Confirm redemption',
      description:
        'Parents only. Ticks a bought reward off as redeemed ("Mia hat ihre Tabletzeit eingelöst"). ' +
        'Pass purchase_id, or member plus reward (names are fine); with several open purchases the oldest is ticked off.',
      inputSchema: {
        purchase_id: z.string().uuid().optional().describe('Id from list_open_redemptions'),
        member: z.string().trim().min(1).optional().describe('Kid who bought it (id or name)'),
        reward: z.string().trim().min(1).optional().describe('Reward (id or name)'),
      },
    },
    async ({ purchase_id, member, reward }) => {
      const who = await parent();
      if (!who.ok) return fail('confirm_redemption', who.text);

      const members = await family();
      let purchase: PurchaseRow | undefined;
      let open: PurchaseRow[];
      try {
        if (purchase_id) {
          open = (await openPurchases()).filter((p) => p.id === purchase_id);
          purchase = open[0];
          if (!purchase) return fail('confirm_redemption', 'Diesen offenen Kauf gibt es nicht (mehr).');
        } else {
          if (!member) {
            return fail('confirm_redemption', 'Wer hat die Belohnung eingelöst? Ich brauche purchase_id oder member und reward.');
          }
          const kid = findMember(members, member);
          if (!kid.ok) return fail('confirm_redemption', kid.text);
          open = await openPurchases(kid.value.id);
          if (reward) {
            const ref = reward.trim();
            const byId = UUID.test(ref);
            open = open.filter((p) => (byId ? p.reward_id === ref : sameName(p.title, ref)));
          }
          if (open.length === 0) {
            return fail(
              'confirm_redemption',
              `${kid.value.name} hat ${reward ? `keine offene Belohnung „${reward}“` : 'keine offenen Belohnungen'}.`,
            );
          }
          if (!reward && new Set(open.map((p) => p.title)).size > 1) {
            const tz = await timeZone(kid.value.family_id);
            return fail(
              'confirm_redemption',
              `Welche Belohnung? ${kid.value.name} hat offen: ${open.map((p) => purchaseLine(p, tz)).join('; ')}.`,
            );
          }
          purchase = open[0];
        }
      } catch (error) {
        return fail('confirm_redemption', `Konnte die Käufe nicht laden: ${(error as Error).message}`);
      }

      const { data, error } = await supabase.rpc('confirm_redemption', { p_purchase_id: purchase.id });
      if (error || !data) {
        return fail('confirm_redemption', error?.message ?? PARENTS_ONLY, { purchaseId: purchase.id });
      }

      await logEvent({ type: 'tool_call', tool: 'confirm_redemption', userId, purchaseId: purchase.id });
      const kid = members.find((m) => m.id === purchase.member_id);
      const tz = await timeZone(who.value.family_id);
      const more = open.length - 1;
      return text(
        `Abgehakt: ${kid ? `${kid.emoji} ${kid.name} — ` : ''}${purchase.label} (−${purchase.cost} ⭐, gekauft ${when(purchase.purchased_at, tz)}).` +
          (more > 0 ? ` Noch ${more} ${more === 1 ? 'weiterer Kauf' : 'weitere Käufe'} offen.` : ''),
      );
    },
  );
}
