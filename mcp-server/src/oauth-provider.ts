import type { Response } from 'express';
import { createClient, type Session } from '@supabase/supabase-js';
import { InvalidGrantError, InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type {
  AuthorizationParams,
  OAuthServerProvider,
} from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { createSealer, fingerprint, type Sealer } from './sealed.js';

// Token kinds (bound into the ciphertext, see sealed.ts) and their lifetimes.
const KIND_CLIENT = 'client';
const KIND_LOGIN = 'login';
const KIND_CODE = 'code';
const KIND_ACCESS = 'access';
const KIND_REFRESH = 'refresh';

const LOGIN_TTL = 10 * 60;
const CODE_TTL = 5 * 60;
const ACCESS_TTL = 60 * 60;
const REFRESH_TTL = 30 * 24 * 60 * 60;

/** The registration fields the auth router actually checks; keeps client ids short. */
const CLIENT_FIELDS = [
  'redirect_uris',
  'client_name',
  'client_secret',
  'client_secret_expires_at',
  'client_id_issued_at',
  'token_endpoint_auth_method',
  'grant_types',
  'response_types',
  'scope',
] as const satisfies readonly (keyof OAuthClientInformationFull)[];

/** Payload of a login request (the hidden `request_id` of the login form). */
interface LoginPayload extends Record<string, unknown> {
  c: string; // client_id
  p: {
    state?: string;
    scopes?: string[];
    codeChallenge: string;
    redirectUri: string;
    resource?: string;
  };
}

/** Payload of an authorization code. */
interface CodePayload extends Record<string, unknown> {
  c: string; // fingerprint(client_id)
  ch: string; // PKCE code challenge
  r: string; // redirect URI the code was issued for
  s: string[]; // scopes
  rt: string; // Supabase refresh token of the freshly signed-in session
}

/** Payload of an access token. */
interface AccessPayload extends Record<string, unknown> {
  c: string; // fingerprint(client_id)
  s: string[];
  u: string; // Supabase user id
  e: string; // email
  at: string; // Supabase access token (JWT) for RLS-scoped queries
}

/** Payload of a refresh token. */
interface RefreshPayload extends Record<string, unknown> {
  c: string; // fingerprint(client_id)
  s: string[];
  rt: string; // Supabase refresh token
}

/**
 * Client "store" without storage: the client id *is* the registration,
 * sealed. Dynamic registration therefore works across restarts and instances.
 */
class SealedClientsStore implements OAuthRegisteredClientsStore {
  constructor(private readonly sealer: Sealer) {}

  getClient(clientId: string): OAuthClientInformationFull | undefined {
    const stored = this.sealer.open<Record<string, unknown>>(KIND_CLIENT, clientId);
    if (!stored) {
      return undefined;
    }
    return { ...stored, client_id: clientId } as OAuthClientInformationFull;
  }

  registerClient(
    client: Omit<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'>,
  ): OAuthClientInformationFull {
    const issuedAt = Math.floor(Date.now() / 1000);
    const full = { ...client, client_id_issued_at: issuedAt } as Omit<OAuthClientInformationFull, 'client_id'>;

    const stored: Record<string, unknown> = {};
    for (const field of CLIENT_FIELDS) {
      if (full[field] !== undefined) {
        stored[field] = full[field];
      }
    }
    // Client ids do not expire; a confidential client's secret expiry is
    // checked by the SDK's client authentication from the stored field.
    const clientId = this.sealer.seal(KIND_CLIENT, stored);
    return { ...full, client_id: clientId };
  }
}

/**
 * OAuth 2.1 authorization server in front of the MCP tools, backed by
 * Supabase Auth and otherwise stateless.
 *
 * Every MCP client (ChatGPT, Claude, ...) goes through a real login screen —
 * email/password checked against Supabase Auth — and is issued tokens tied to
 * that user's own Supabase session, so the family tables' RLS policies apply
 * per signed-in account instead of one shared credential.
 *
 * Nothing is kept in memory or on disk between requests: client ids, login
 * requests, authorization codes, access and refresh tokens are all sealed
 * (encrypted + authenticated) with TOKEN_SECRET and carry their own state.
 * Consequences:
 * - restarts, redeploys and scale-to-zero (Cloud Run) do not log anyone out;
 * - an authorization code can be exchanged only once in practice, because
 *   exchanging it consumes the Supabase refresh token inside it;
 * - revoking a token ends its Supabase session, so its refresh token stops
 *   working at once, while the access token stays valid until it expires
 *   (at most one hour).
 */
export class SupabaseOAuthProvider implements OAuthServerProvider {
  private readonly sealer: Sealer;
  readonly clientsStore: SealedClientsStore;

  constructor(
    private readonly supabaseUrl: string,
    private readonly supabaseAnonKey: string,
    tokenSecret: string,
  ) {
    this.sealer = createSealer(tokenSecret);
    this.clientsStore = new SealedClientsStore(this.sealer);
  }

  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    const payload: LoginPayload = {
      c: client.client_id,
      p: {
        state: params.state,
        scopes: params.scopes,
        codeChallenge: params.codeChallenge,
        redirectUri: params.redirectUri,
        resource: params.resource?.href,
      },
    };
    const requestId = this.sealer.seal(KIND_LOGIN, payload, LOGIN_TTL);
    res.type('html').send(renderLoginPage(requestId, client.client_name));
  }

  async challengeForAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    return this.openCode(client, authorizationCode).ch;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
  ): Promise<OAuthTokens> {
    const code = this.openCode(client, authorizationCode);
    if (redirectUri !== undefined && redirectUri !== code.r) {
      throw new InvalidGrantError('redirect_uri does not match the authorization request');
    }
    // Turning the code's refresh token into a session also spends it, so a
    // replayed code fails here.
    const session = await this.refreshSupabaseSession(code.rt);
    return this.issueTokens(client, code.s, session);
  }

  async exchangeRefreshToken(client: OAuthClientInformationFull, refreshToken: string): Promise<OAuthTokens> {
    const record = this.sealer.open<RefreshPayload>(KIND_REFRESH, refreshToken);
    if (!record || record.c !== fingerprint(client.client_id)) {
      throw new InvalidGrantError('Invalid refresh token');
    }
    const session = await this.refreshSupabaseSession(record.rt);
    return this.issueTokens(client, record.s, session);
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const record = this.sealer.open<AccessPayload>(KIND_ACCESS, token);
    if (!record) {
      throw new InvalidTokenError('Invalid or expired access token');
    }
    return {
      token,
      // The sealed client id is long; tokens carry its fingerprint instead.
      clientId: record.c,
      scopes: record.s,
      expiresAt: record.exp,
      extra: {
        supabaseUserId: record.u,
        supabaseEmail: record.e,
        supabaseAccessToken: record.at,
      },
    };
  }

  async revokeToken(client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    const clientFingerprint = fingerprint(client.client_id);
    try {
      const access = this.sealer.open<AccessPayload>(KIND_ACCESS, request.token);
      if (access) {
        if (access.c === clientFingerprint) {
          // Ends this Supabase session: its refresh token stops working now,
          // the access token itself runs out within the hour.
          await this.authClient().auth.admin.signOut(access.at, 'local');
        }
        return;
      }
      const refresh = this.sealer.open<RefreshPayload>(KIND_REFRESH, request.token);
      if (refresh && refresh.c === clientFingerprint) {
        const session = await this.refreshSupabaseSession(refresh.rt);
        await this.authClient().auth.admin.signOut(session.access_token, 'local');
      }
    } catch {
      // Per spec, revoking an unknown or already revoked token is a no-op.
    }
  }

  /** Called by the app's POST /login route once the login form is submitted. */
  async completeLogin(requestId: string, email: string, password: string): Promise<string> {
    const login = this.sealer.open<LoginPayload>(KIND_LOGIN, requestId);
    if (!login) {
      throw new Error('Anmelde-Sitzung abgelaufen. Bitte den Connector erneut verbinden.');
    }

    const { data, error } = await this.authClient().auth.signInWithPassword({ email, password });
    if (error || !data.session) {
      throw new Error(error?.message ?? 'Anmeldung fehlgeschlagen');
    }

    const payload: CodePayload = {
      c: fingerprint(login.c),
      ch: login.p.codeChallenge,
      r: login.p.redirectUri,
      s: login.p.scopes ?? [],
      rt: data.session.refresh_token,
    };
    const code = this.sealer.seal(KIND_CODE, payload, CODE_TTL);

    const redirectUrl = new URL(login.p.redirectUri);
    redirectUrl.searchParams.set('code', code);
    if (login.p.state !== undefined) {
      redirectUrl.searchParams.set('state', login.p.state);
    }
    return redirectUrl.href;
  }

  private openCode(client: OAuthClientInformationFull, authorizationCode: string): CodePayload {
    const code = this.sealer.open<CodePayload>(KIND_CODE, authorizationCode);
    if (!code) {
      throw new InvalidGrantError('Unknown or expired authorization code');
    }
    if (code.c !== fingerprint(client.client_id)) {
      throw new InvalidGrantError('Authorization code was not issued to this client');
    }
    return code;
  }

  private authClient() {
    return createClient(this.supabaseUrl, this.supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  private async refreshSupabaseSession(refreshToken: string): Promise<Session> {
    const { data, error } = await this.authClient().auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data.session) {
      throw new InvalidGrantError(`Supabase session could not be refreshed: ${error?.message ?? 'no session'}`);
    }
    return data.session;
  }

  private issueTokens(client: OAuthClientInformationFull, scopes: string[], session: Session): OAuthTokens {
    const clientFingerprint = fingerprint(client.client_id);
    const now = Math.floor(Date.now() / 1000);
    // Never outlive the Supabase JWT inside, which the tools use for RLS.
    const expiresIn = Math.max(
      60,
      Math.min(ACCESS_TTL, session.expires_at !== undefined ? session.expires_at - now - 30 : ACCESS_TTL),
    );

    const access: AccessPayload = {
      c: clientFingerprint,
      s: scopes,
      u: session.user.id,
      e: session.user.email ?? '',
      at: session.access_token,
    };
    const refresh: RefreshPayload = {
      c: clientFingerprint,
      s: scopes,
      rt: session.refresh_token,
    };

    return {
      access_token: this.sealer.seal(KIND_ACCESS, access, expiresIn),
      token_type: 'bearer',
      expires_in: expiresIn,
      refresh_token: this.sealer.seal(KIND_REFRESH, refresh, REFRESH_TTL),
      scope: scopes.join(' '),
    };
  }
}

export function renderLoginPage(requestId: string, clientName?: string, errorMessage?: string): string {
  return `<!doctype html>
<html lang="de">
  <head>
    <meta charset="utf-8" />
    <title>Familyfux anmelden</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { font-family: system-ui, sans-serif; display: flex; min-height: 100vh; align-items: center; justify-content: center; margin: 0; background: #f5f5f5; }
      form { background: white; padding: 2rem; border-radius: 0.75rem; box-shadow: 0 1px 4px rgba(0,0,0,0.15); width: 20rem; }
      h1 { font-size: 1.1rem; margin: 0 0 0.25rem; }
      p.subtitle { font-size: 0.8rem; color: #666; margin: 0 0 1.25rem; }
      label { display: block; font-size: 0.85rem; margin-bottom: 0.25rem; }
      input { width: 100%; padding: 0.5rem; margin-bottom: 1rem; box-sizing: border-box; border: 1px solid #ccc; border-radius: 0.4rem; }
      button { width: 100%; padding: 0.6rem; border: none; border-radius: 0.4rem; background: #111; color: white; cursor: pointer; }
      .error { color: #b91c1c; font-size: 0.85rem; margin: -0.5rem 0 1rem; }
    </style>
  </head>
  <body>
    <form method="POST" action="/login">
      <h1>Bei Familyfux anmelden</h1>
      <p class="subtitle">${escapeHtml(clientName ?? 'Diese App')} möchte Aufgaben für dich anlegen.</p>
      ${errorMessage ? `<p class="error">${escapeHtml(errorMessage)}</p>` : ''}
      <input type="hidden" name="request_id" value="${escapeHtml(requestId)}" />
      <label for="email">Email</label>
      <input type="email" id="email" name="email" required autofocus />
      <label for="password">Passwort</label>
      <input type="password" id="password" name="password" required />
      <button type="submit">Anmelden &amp; Zugriff erlauben</button>
    </form>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return value.replace(/[&<>"']/g, (char) => map[char]!);
}
