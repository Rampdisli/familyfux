import { randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Recipe import ("Essen"): reading a recipe page and copying its picture into
 * our own storage. The tools in index.ts use this; saving goes into the
 * existing `recipes` table (supabase/migrations/20260929090000_meals.sql).
 */

/** Storage bucket for recipe pictures (supabase/migrations/20260929110000_recipe_images.sql). */
export const RECIPE_IMAGES_BUCKET = 'recipe-images';

const PAGE_MAX_BYTES = 3 * 1024 * 1024;
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;

/** Picture types the bucket accepts, with the file extension they're saved under. */
const IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};

/** Ask the site for HTML like a browser would; some recipe sites refuse unknown clients. */
const USER_AGENT = 'Mozilla/5.0 (compatible; FuxisPlan-RecipeImport/1.0)';

export interface RecipeDraft {
  title: string | null;
  ingredients: string[];
  image_url: string | null;
  /** Where the data came from: structured recipe data (schema.org) or only the page's title / preview image. */
  source: 'schema.org' | 'page';
}

// ---------------------------------------------------------------------------
// Fetching outside URLs safely
// ---------------------------------------------------------------------------

/** Loopback, private, link-local, CGNAT … — the NAS must not fetch its own network for a "recipe". */
function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 6) {
    const a = address.toLowerCase();
    const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) {
      return isPrivateAddress(mapped[1]);
    }
    return a === '::' || a === '::1' || a.startsWith('fc') || a.startsWith('fd') || /^fe[89ab]/.test(a);
  }

  const [a, b] = address.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

async function assertPublicUrl(url: URL): Promise<void> {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Only http(s) links can be imported.');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error(`${url.hostname} is not a public website.`);
  }
}

/** GET with a timeout, following redirects only to public addresses; the body is capped at maxBytes. */
async function fetchPublic(rawUrl: string, accept: string, maxBytes: number): Promise<{ url: URL; type: string; body: Buffer }> {
  let url = new URL(rawUrl);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicUrl(url);

    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'user-agent': USER_AGENT, accept },
    });

    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      url = new URL(location, url);
      continue;
    }
    if (!response.ok || !response.body) {
      throw new Error(`${url.hostname} answered with HTTP ${response.status}.`);
    }

    const declared = Number(response.headers.get('content-length'));
    if (declared > maxBytes) {
      throw new Error(`The file is too big (${Math.round(declared / 1024)} KB).`);
    }

    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > maxBytes) {
        throw new Error(`The file is too big (over ${Math.round(maxBytes / 1024)} KB).`);
      }
      chunks.push(Buffer.from(chunk));
    }

    const type = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    return { url, type, body: Buffer.concat(chunks) };
  }

  throw new Error('Too many redirects.');
}

// ---------------------------------------------------------------------------
// Reading a recipe page
// ---------------------------------------------------------------------------

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Plain text: tags removed, HTML entities decoded, whitespace collapsed. */
function clean(text: string): string {
  return text
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
      if (code[0] === '#') {
        const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(n) ? String.fromCodePoint(n) : entity;
      }
      return ENTITIES[code.toLowerCase()] ?? entity;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

function hasType(node: Record<string, unknown>, type: string): boolean {
  const t = node['@type'];
  return Array.isArray(t) ? t.includes(type) : t === type;
}

/** The first schema.org Recipe anywhere in a JSON-LD value (top level, arrays, @graph, mainEntity …). */
function findRecipe(value: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 6 || value === null || typeof value !== 'object') {
    return null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findRecipe(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const node = value as Record<string, unknown>;
  if (hasType(node, 'Recipe')) {
    return node;
  }
  for (const child of Object.values(node)) {
    const found = findRecipe(child, depth + 1);
    if (found) return found;
  }
  return null;
}

/** schema.org image: "url", ["url", …], {url}, [{url}, …]. */
function imageFrom(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const url = imageFrom(item);
      if (url) return url;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    const url = (value as Record<string, unknown>)['url'] ?? (value as Record<string, unknown>)['contentUrl'];
    return typeof url === 'string' ? url : null;
  }
  return null;
}

function metaContent(html: string, property: string): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const name = tag.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1];
    if (name?.toLowerCase() === property) {
      const content = tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i)?.[1];
      if (content) return clean(content);
    }
  }
  return null;
}

function absolute(url: string | null, base: URL): string | null {
  if (!url) return null;
  try {
    const resolved = new URL(url, base);
    return resolved.protocol === 'https:' || resolved.protocol === 'http:' ? resolved.href : null;
  } catch {
    return null;
  }
}

/** Title, ingredients and picture of a recipe page: schema.org data if the page has it, else its title / preview image. */
export function extractRecipe(html: string, pageUrl: URL): RecipeDraft {
  let recipe: Record<string, unknown> | null = null;
  for (const [, json] of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      recipe = findRecipe(JSON.parse(json.trim()));
    } catch {
      // Broken JSON-LD happens; try the next block.
    }
    if (recipe) break;
  }

  const pageTitle = metaContent(html, 'og:title') ?? clean(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '');
  const pageImage = metaContent(html, 'og:image');

  if (recipe) {
    const rawIngredients = recipe['recipeIngredient'] ?? recipe['ingredients'];
    const ingredients = (Array.isArray(rawIngredients) ? rawIngredients : [rawIngredients])
      .filter((i): i is string => typeof i === 'string')
      .map(clean)
      .filter(Boolean);
    const name = typeof recipe['name'] === 'string' ? clean(recipe['name']) : '';
    return {
      title: name || pageTitle || null,
      ingredients,
      image_url: absolute(imageFrom(recipe['image']) ?? pageImage, pageUrl),
      source: 'schema.org',
    };
  }

  return { title: pageTitle || null, ingredients: [], image_url: absolute(pageImage, pageUrl), source: 'page' };
}

/** Fetches a recipe page and reads title, ingredients and picture from it. */
export async function readRecipePage(url: string): Promise<RecipeDraft & { url: string }> {
  const page = await fetchPublic(url, 'text/html,application/xhtml+xml', PAGE_MAX_BYTES);
  if (page.type && !page.type.includes('html')) {
    throw new Error(`The link is not a web page (${page.type}).`);
  }
  return { ...extractRecipe(page.body.toString('utf8'), page.url), url: page.url.href };
}

// ---------------------------------------------------------------------------
// Copying the picture
// ---------------------------------------------------------------------------

/** Whether a picture URL already points into our own bucket (nothing to copy). */
export function isOwnImage(imageUrl: string, supabaseUrl: string): boolean {
  return imageUrl.startsWith(`${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/${RECIPE_IMAGES_BUCKET}/`);
}

/** Downloads a picture and stores it under <familyId>/; resolves to its public URL and storage path. */
export async function copyImage(
  supabase: SupabaseClient,
  familyId: string,
  imageUrl: string,
): Promise<{ publicUrl: string; path: string }> {
  const image = await fetchPublic(imageUrl, 'image/*', IMAGE_MAX_BYTES);
  const extension = IMAGE_TYPES[image.type];
  if (!extension) {
    throw new Error(`Not a supported picture (${image.type || 'unknown type'}).`);
  }

  const path = `${familyId}/${randomUUID()}.${extension}`;
  const { error } = await supabase.storage
    .from(RECIPE_IMAGES_BUCKET)
    .upload(path, image.body, { contentType: image.type, upsert: false });
  if (error) {
    throw new Error(`Upload failed: ${error.message}`);
  }

  return { publicUrl: supabase.storage.from(RECIPE_IMAGES_BUCKET).getPublicUrl(path).data.publicUrl, path };
}
