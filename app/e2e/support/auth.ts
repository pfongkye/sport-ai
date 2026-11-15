import type { BrowserContext } from '@playwright/test'

/**
 * Seeds a Supabase session cookie so proxy.ts / server components see a signed-in
 * user. Cookie name = SUPABASE_STORAGE_KEY ('sb-sportai-auth'); @supabase/ssr stores
 * the session JSON as `base64-<base64url>`. The token is never verified: the stub
 * server's /auth/v1/user accepts anything, and expires_at is far in the future so
 * no refresh is attempted.
 */
export async function signIn(context: BrowserContext, baseURL: string) {
  const session = {
    access_token: 'e2e-access-token',
    refresh_token: 'e2e-refresh-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: 4102444800,
    user: { id: '00000000-0000-4000-8000-000000000001', email: 'e2e@example.com' },
  }
  const value = 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64url')
  await context.addCookies([{ name: 'sb-sportai-auth', value, url: baseURL }])
}
