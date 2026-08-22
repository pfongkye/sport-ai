import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/types/database'
import { SUPABASE_PUBLIC_URL, SUPABASE_ANON_KEY, SUPABASE_STORAGE_KEY } from './config'

/**
 * Supabase client for use in Client Components.
 * Creates a new instance per call — safe to call in render.
 *
 * Uses an explicit storageKey so the auth cookie names match the server client,
 * even though browser and server reach Supabase via different URLs.
 */
export function createClient() {
  return createBrowserClient<Database>(SUPABASE_PUBLIC_URL, SUPABASE_ANON_KEY, {
    auth: {
      storageKey: SUPABASE_STORAGE_KEY,
      flowType: 'pkce',
    },
  })
}
