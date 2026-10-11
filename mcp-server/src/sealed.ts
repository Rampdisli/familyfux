import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';

/**
 * Sealed tokens: a JSON payload encrypted and authenticated with AES-256-GCM,
 * encoded as base64url. Whoever holds the token cannot read or alter it; only
 * this server (with TOKEN_SECRET) can open it again.
 *
 * This is what lets the OAuth server run without any storage: client ids,
 * login requests, authorization codes, access and refresh tokens all carry
 * their own state. Any instance with the same secret can open any token, so
 * the server survives restarts and Cloud Run's scale-to-zero.
 *
 * Layout: 1 byte version | 12 byte nonce | ciphertext | 16 byte GCM tag.
 * The token's kind ("access", "refresh", ...) is bound in as additional
 * authenticated data, so a refresh token can never be opened as an access token.
 */

const VERSION = 1;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const MIN_SECRET_LENGTH = 32;

export interface Sealer {
  /** Encrypts `payload` as a token of `kind`; `exp` (unix seconds) is added when a TTL is given. */
  seal(kind: string, payload: Record<string, unknown>, ttlSeconds?: number): string;
  /** Decrypts a token of `kind`; undefined if it is malformed, tampered with, of another kind, or expired. */
  open<T extends Record<string, unknown>>(kind: string, token: string): (T & { exp?: number }) | undefined;
}

export function createSealer(secret: string): Sealer {
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`TOKEN_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);
  }
  // HKDF turns the (arbitrary-length, possibly base64) secret into a 32-byte key.
  const key = Buffer.from(hkdfSync('sha256', secret, 'familyfux-mcp', 'oauth-sealed-tokens', 32));

  return {
    seal(kind, payload, ttlSeconds) {
      const body =
        ttlSeconds === undefined ? payload : { ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
      const nonce = randomBytes(NONCE_BYTES);
      const cipher = createCipheriv('aes-256-gcm', key, nonce);
      cipher.setAAD(aad(kind));
      const ciphertext = Buffer.concat([cipher.update(JSON.stringify(body), 'utf8'), cipher.final()]);
      return Buffer.concat([Buffer.from([VERSION]), nonce, ciphertext, cipher.getAuthTag()]).toString('base64url');
    },

    open(kind, token) {
      try {
        const raw = Buffer.from(token, 'base64url');
        if (raw.length < 1 + NONCE_BYTES + TAG_BYTES || raw[0] !== VERSION) {
          return undefined;
        }
        const nonce = raw.subarray(1, 1 + NONCE_BYTES);
        const ciphertext = raw.subarray(1 + NONCE_BYTES, raw.length - TAG_BYTES);
        const tag = raw.subarray(raw.length - TAG_BYTES);

        const decipher = createDecipheriv('aes-256-gcm', key, nonce);
        decipher.setAAD(aad(kind));
        decipher.setAuthTag(tag);
        const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');

        const payload = JSON.parse(plaintext);
        if (payload === null || typeof payload !== 'object') {
          return undefined;
        }
        if (payload.exp !== undefined) {
          if (typeof payload.exp !== 'number' || payload.exp <= Math.floor(Date.now() / 1000)) {
            return undefined;
          }
        }
        return payload;
      } catch {
        return undefined;
      }
    },
  };
}

function aad(kind: string): Buffer {
  return Buffer.from(`familyfux-mcp/${VERSION}/${kind}`, 'utf8');
}

/** Short, stable stand-in for a (long) sealed client id inside other tokens. */
export function fingerprint(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}
