import { randomBytes, randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { createClient } from '@supabase/supabase-js';
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

interface PendingAuthorization {
  client: OAuthClientInformationFull;
  params: AuthorizationParams;
}

interface SupabaseSession {
  userId: string;
  email: string;
  accessToken: string;
  refreshToken: string;
}

interface IssuedToken {
  clientId: string;
  scopes: string[];
  expiresAt: number;
  refreshToken: string;
  supabase: SupabaseSession;
}

class InMemoryClientsStore implements OAuthRegisteredClientsStore {
  private readonly clients = new Map<string, OAuthClientInformationFull>();

  getClient(clientId: string): OAuthClientInformationFull | undefined {
    return this.clients.get(clientId);
  }

  registerClient(
    client: Omit<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'>,
  ): OAuthClientInformationFull {
    const full: OAuthClientInformationFull = {
      ...client,
      client_id: randomUUID(),
      client_id_issued_at: Math.floor(Date.now() / 1000),
    };
    this.clients.set(full.client_id, full);
    return full;
  }
}

/**
 * OAuth 2.1 authorization server that sits in front of the `create_task` tool.
 * Instead of a fixed service account baked into `.env`, every MCP client
 * (ChatGPT, Claude, ...) goes through a real login screen — email/password
 * checked against Supabase Auth — and is issued a token tied to that user's
 * own Supabase session, so the existing `tasks` RLS policies keep applying
 * per-client instead of a single shared credential.
 */
export class SupabaseOAuthProvider implements OAuthServerProvider {
  readonly clientsStore = new InMemoryClientsStore();

  private readonly pending = new Map<string, PendingAuthorization>();
  private readonly codes = new Map<string, PendingAuthorization & { supabase: SupabaseSession }>();
  private readonly tokens = new Map<string, IssuedToken>();
  private readonly tokensByRefreshToken = new Map<string, string>();

  constructor(
    private readonly supabaseUrl: string,
    private readonly supabaseAnonKey: string,
  ) {}

  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    const requestId = randomUUID();
    this.pending.set(requestId, { client, params });
    res.type('html').send(renderLoginPage(requestId, client.client_name));
  }

  async challengeForAuthorizationCode(
    _client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    const entry = this.codes.get(authorizationCode);
    if (!entry) {
      throw new InvalidGrantError('Unknown authorization code');
    }
    return entry.params.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<OAuthTokens> {
    const entry = this.codes.get(authorizationCode);
    if (!entry) {
      throw new InvalidGrantError('Unknown authorization code');
    }
    if (entry.client.client_id !== client.client_id) {
      throw new InvalidGrantError('Authorization code was not issued to this client');
    }

    this.codes.delete(authorizationCode);
    return this.issueTokens(client, entry.params.scopes ?? [], entry.supabase);
  }

  async exchangeRefreshToken(client: OAuthClientInformationFull, refreshToken: string): Promise<OAuthTokens> {
    const accessToken = this.tokensByRefreshToken.get(refreshToken);
    const record = accessToken ? this.tokens.get(accessToken) : undefined;

    if (!record || record.clientId !== client.client_id) {
      throw new InvalidGrantError('Invalid refresh token');
    }

    const supabase = createClient(this.supabaseUrl, this.supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await supabase.auth.refreshSession({
      refresh_token: record.supabase.refreshToken,
    });

    if (error || !data.session) {
      throw new InvalidGrantError(`Supabase session could not be refreshed: ${error?.message}`);
    }

    this.tokens.delete(accessToken!);
    this.tokensByRefreshToken.delete(refreshToken);

    return this.issueTokens(client, record.scopes, {
      userId: data.session.user.id,
      email: data.session.user.email ?? record.supabase.email,
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
    });
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const record = this.tokens.get(token);
    if (!record || record.expiresAt < Date.now()) {
      throw new InvalidTokenError('Invalid or expired access token');
    }

    return {
      token,
      clientId: record.clientId,
      scopes: record.scopes,
      expiresAt: Math.floor(record.expiresAt / 1000),
      extra: {
        supabaseUserId: record.supabase.userId,
        supabaseEmail: record.supabase.email,
        supabaseAccessToken: record.supabase.accessToken,
      },
    };
  }

  async revokeToken(_client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    if (this.tokens.has(request.token)) {
      const record = this.tokens.get(request.token)!;
      this.tokens.delete(request.token);
      this.tokensByRefreshToken.delete(record.refreshToken);
      return;
    }

    const accessToken = this.tokensByRefreshToken.get(request.token);
    if (accessToken) {
      this.tokens.delete(accessToken);
      this.tokensByRefreshToken.delete(request.token);
    }
  }

  /** Called by the app's POST /login route once the login form is submitted. */
  async completeLogin(requestId: string, email: string, password: string): Promise<string> {
    const pending = this.pending.get(requestId);
    if (!pending) {
      throw new Error('Anmelde-Sitzung abgelaufen. Bitte den Connector erneut verbinden.');
    }

    const supabase = createClient(this.supabaseUrl, this.supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error || !data.session) {
      throw new Error(error?.message ?? 'Anmeldung fehlgeschlagen');
    }

    this.pending.delete(requestId);

    const code = randomUUID();
    this.codes.set(code, {
      ...pending,
      supabase: {
        userId: data.session.user.id,
        email: data.session.user.email ?? email,
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
      },
    });

    const redirectUrl = new URL(pending.params.redirectUri);
    redirectUrl.searchParams.set('code', code);
    if (pending.params.state !== undefined) {
      redirectUrl.searchParams.set('state', pending.params.state);
    }
    return redirectUrl.href;
  }

  private issueTokens(
    client: OAuthClientInformationFull,
    scopes: string[],
    supabase: SupabaseSession,
  ): OAuthTokens {
    const accessToken = randomBytes(32).toString('hex');
    const refreshToken = randomBytes(32).toString('hex');
    const expiresIn = 3600;

    this.tokens.set(accessToken, {
      clientId: client.client_id,
      scopes,
      expiresAt: Date.now() + expiresIn * 1000,
      refreshToken,
      supabase,
    });
    this.tokensByRefreshToken.set(refreshToken, accessToken);

    return {
      access_token: accessToken,
      token_type: 'bearer',
      expires_in: expiresIn,
      refresh_token: refreshToken,
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
