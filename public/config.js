/**
 * Runtime configuration for the production build.
 *
 * In the Docker image this file is regenerated on container start from the
 * SUPABASE_URL / SUPABASE_ANON_KEY environment variables
 * (see `docker/30-familyfux-config.sh`), so one image can be pointed at any
 * Supabase project without rebuilding.
 *
 * `ng serve` reads `src/environments/environment.ts` instead and ignores these
 * values — they only exist so the file is present in every build.
 */
window.__env = {
  supabaseUrl: '',
  supabaseAnonKey: '',
};
