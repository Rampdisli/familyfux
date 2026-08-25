import { createClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';

/**
 * Single shared Supabase client instance for the whole app.
 * The `supabase-js` client already manages its own state/caching,
 * so there is no need to wrap it in an injectable service.
 */
export const supabase = createClient(environment.supabaseUrl, environment.supabaseAnonKey);
