import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/types/database'
import { SUPABASE_PUBLIC_URL, SUPABASE_ANON_KEY, SUPABASE_STORAGE_KEY } from './config'

/**
 * When tunnelling via ngrok free tier, the Supabase client's own fetches to the
 * (separate) Supabase tunnel also hit the interstitial. Inject the skip header
 * on its fetch — only in tunnel mode, so production is untouched.
 */
const tunnelFetch: typeof fetch | undefined =
  process.env.NEXT_PUBLIC_TUNNEL_MODE === 'ngrok'
    ? (input, init = {}) => {
        const headers = new Headers(init.headers)
        headers.set('ngrok-skip-browser-warning', 'true')
        return fetch(input, { ...init, headers })
      }
    : undefined

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
    ...(tunnelFetch ? { global: { fetch: tunnelFetch } } : {}),
  })
}
