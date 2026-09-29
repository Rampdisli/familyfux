/**
 * Plays create → update → archive → restore of the reward tools through a real
 * MCP client, against a LOCAL Supabase (never production: it writes rewards).
 *
 *   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=… \
 *   SMOKE_EMAIL=parent@example.com SMOKE_PASSWORD=… npm run smoke:rewards
 *
 * The account must be a parent in a family. Instead of email / password,
 * SMOKE_ACCESS_TOKEN (a JWT for that user) works too. The test reward is
 * deleted again at the end.
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createClient } from '@supabase/supabase-js';
import { registerRewardTools } from '../src/rewards.js';

const { SUPABASE_URL, SUPABASE_ANON_KEY, SMOKE_EMAIL, SMOKE_PASSWORD, SMOKE_ACCESS_TOKEN } = process.env;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !(SMOKE_ACCESS_TOKEN || (SMOKE_EMAIL && SMOKE_PASSWORD))) {
  throw new Error('Set SUPABASE_URL, SUPABASE_ANON_KEY and SMOKE_EMAIL + SMOKE_PASSWORD (or SMOKE_ACCESS_TOKEN).');
}
if (/supabase\.co/.test(SUPABASE_URL) && !process.env.SMOKE_ALLOW_REMOTE) {
  throw new Error('Refusing to run against a hosted project; use a local Supabase (or set SMOKE_ALLOW_REMOTE=1).');
}

let token = SMOKE_ACCESS_TOKEN;
if (!token) {
  const auth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await auth.auth.signInWithPassword({ email: SMOKE_EMAIL!, password: SMOKE_PASSWORD! });
  if (error) throw error;
  token = data.session.access_token;
}
const userId = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub as string;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { Authorization: `Bearer ${token}` } },
});

const server = new McpServer({ name: 'rewards-smoke', version: '0.0.0' });
registerRewardTools(server, supabase, userId, async () => {});
const client = new Client({ name: 'rewards-smoke', version: '0.0.0' });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

const title = `Smoke-Test ${Date.now() % 100000}`;

/** Calls a tool, prints its answer and returns the text. */
async function call(name: string, args: Record<string, unknown>, expectError = false): Promise<string> {
  const result = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
  const text = result.content.map((c) => c.text).join('\n');
  console.log(`\n> ${name} ${JSON.stringify(args)}\n${result.isError ? '[error] ' : ''}${text}`);
  assert.equal(!!result.isError, expectError, `${name}: unexpected ${result.isError ? 'error' : 'success'}`);
  return text;
}

let rewardId: string | undefined;
try {
  const created = await call('create_reward', { title, price: 40, unit_amount: 10, unit_label: 'Minuten', category: 'screen' });
  assert.match(created, /Gespeichert: 📱 .* — 10 Minuten für 40 ⭐, bis 6× pro Kauf/);
  rewardId = created.match(/id: ([0-9a-f-]{36})/)?.[1];
  assert.ok(rewardId, 'create_reward names the id');

  await call('create_reward', { title: title.toUpperCase(), price: 10 }, true);

  const updated = await call('update_reward', { reward: title.toLowerCase(), price: 45 });
  assert.match(updated, /40 ⭐ → 45 ⭐ pro 10 Minuten/);

  const single = await call('update_reward', { reward: rewardId, unit_amount: null, description: 'am Wochenende' });
  assert.match(single, /pro Kauf/);

  assert.match(await call('archive_reward', { reward: title }), /Archiviert/);
  assert.doesNotMatch(await call('list_rewards', {}), new RegExp(title));
  assert.match(await call('list_rewards', { include_archived: true }), new RegExp(`${title}.*archiviert`));

  assert.match(await call('restore_reward', { reward: title }), /Wieder im Shop: 📱 .* — 45 ⭐ pro Kauf \(am Wochenende\)/);
  assert.match(await call('list_rewards', { category: 'screen' }), new RegExp(title));

  await call('list_open_redemptions', {});
  console.log('\nrewards smoke test: ok');
} finally {
  if (rewardId) {
    await supabase.from('rewards').delete().eq('id', rewardId);
  }
  await client.close();
}
