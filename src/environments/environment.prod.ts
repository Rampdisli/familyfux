/**
 * Production config, read from `window.__env` — written by the container at
 * startup into `config.js`, which `src/index.html` loads before the bundle.
 * See `docker/30-familyfux-config.sh`.
 */
declare global {
  interface Window {
    __env?: {
      supabaseUrl?: string;
      supabaseAnonKey?: string;
    };
  }
}

const runtime = window.__env ?? {};

export const environment = {
  production: true,
  supabaseUrl: runtime.supabaseUrl ?? '',
  supabaseAnonKey: runtime.supabaseAnonKey ?? '',
};
