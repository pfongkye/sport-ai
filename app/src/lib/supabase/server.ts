import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from '@/types/database'
import { SUPABASE_SERVER_URL, SUPABASE_ANON_KEY } from './config'

/**
 * Supabase client for use in Server Components, Server Actions, and Route Handlers.
 * Uses the internal Docker URL when running in a container so it can reach the
 * gateway on the Docker network. Reads/writes auth cookies via next/headers.
 */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient<Database>(SUPABASE_SERVER_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        } catch {
          // setAll called from a Server Component — safe to ignore
          // middleware will handle session refresh
        }
      },
    },
  })
}

/**
 * Supabase admin client using service role key.
 * NEVER expose this to the client. Use only in server-side trusted contexts.
 */
export async function createAdminClient() {
  const { createClient: createSupabaseClient } = await import('@supabase/supabase-js')
  return createSupabaseClient<Database>(
    SUPABASE_SERVER_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  )
}
