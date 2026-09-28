import { createClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';

/** How long to wait before retrying a request refused with "JWT issued at future". */
const CLOCK_SKEW_RETRY_MS = 1000;

/**
 * fetch that retries once when the API refuses a just-refreshed token as
 * "JWT issued at future" (PostgREST PGRST303): right after a token refresh,
 * a Supabase API node whose clock is a moment behind the auth server's can
 * reject it, while the same token works on the other nodes. A second later
 * it's accepted everywhere.
 */
async function fetchWithClockSkewRetry(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, init);
  if (response.status !== 401) {
    return response;
  }

  const body = await response
    .clone()
    .json()
    .catch(() => null);
  if (body?.code !== 'PGRST303') {
    return response;
  }

  await new Promise((resolve) => setTimeout(resolve, CLOCK_SKEW_RETRY_MS));
  return fetch(input, init);
}

/**
 * Single shared Supabase client instance for the whole app.
 * The `supabase-js` client already manages its own state/caching,
 * so there is no need to wrap it in an injectable service.
 */
export const supabase = createClient(environment.supabaseUrl, environment.supabaseAnonKey, {
  global: { fetch: fetchWithClockSkewRetry },
});
