/**
 * Production config, read from `window.__env` — written by the container at
 * startup into `config.js`, which `src/index.html` loads before the bundle.
 * See `docker/30-familyfux-config.sh`.
 */
import type { BuildInfo } from './build-info';

declare global {
  interface Window {
    __env?: {
      supabaseUrl?: string;
      supabaseAnonKey?: string;
      build?: Partial<BuildInfo>;
    };
  }
}

const runtime = window.__env ?? {};

export const environment = {
  production: true,
  supabaseUrl: runtime.supabaseUrl ?? '',
  supabaseAnonKey: runtime.supabaseAnonKey ?? '',
  build: {
    version: runtime.build?.version ?? '',
    commit: runtime.build?.commit ?? '',
    builtAt: runtime.build?.builtAt ?? '',
  } satisfies BuildInfo,
};
