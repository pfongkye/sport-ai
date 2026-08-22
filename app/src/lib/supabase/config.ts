/**
 * Supabase URL resolution for the two runtime contexts:
 *
 * - Browser (client-side): must use the PUBLIC url reachable from the host,
 *   e.g. http://localhost:8000 (or your Ngrok domain). This is what OAuth
 *   redirects and all client fetches use.
 *
 * - Server-side (Next.js running inside the Docker container): should use the
 *   INTERNAL Docker network hostname (http://api-gw:8000) because "localhost"
 *   inside a container refers to the container itself, not the host.
 *   Falls back to the public URL when not running in Docker (e.g. `npm run dev`
 *   directly on the host).
 */

/** Public URL — safe for the browser. Always NEXT_PUBLIC_SUPABASE_URL. */
export const SUPABASE_PUBLIC_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!

/** Anon key — public, RLS-enforced. */
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

/**
 * URL to use for server-side Supabase calls.
 * Prefers SUPABASE_INTERNAL_URL (set in docker-compose for the container),
 * otherwise falls back to the public URL.
 */
export const SUPABASE_SERVER_URL =
  process.env.SUPABASE_INTERNAL_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!
