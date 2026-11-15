/**
 * Resolve the public-facing origin (scheme + host[:port]) of the app.
 *
 * Behind a proxy/tunnel (ngrok, Cloud Run) the framework's own URL reflects the
 * internal address, and in Docker `request.nextUrl` can even drop the port.
 * Resolution order:
 *  1. x-forwarded-host (+ x-forwarded-proto, default https; http for localhost).
 *     The forwarded host may already carry a port; it is kept as-is.
 *  2. Host header (includes the port for direct localhost:3000 access).
 *  3. NEXT_PUBLIC_APP_URL
 *  4. fallbackUrl origin
 * See AGENTS.md #14 and the port-drop gotcha.
 */
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/

const first = (v: string | null) => v?.split(',')[0]?.trim() || null

export function resolvePublicOrigin(headers: Headers, fallbackUrl: string): string {
  const forwardedHost = first(headers.get('x-forwarded-host'))
  const forwardedProto = first(headers.get('x-forwarded-proto'))
  if (forwardedHost) {
    const proto = forwardedProto ?? (LOCAL_HOST.test(forwardedHost) ? 'http' : 'https')
    return `${proto}://${forwardedHost}`
  }
  const host = first(headers.get('host'))
  if (host) {
    const proto = forwardedProto ?? (LOCAL_HOST.test(host) ? 'http' : new URL(fallbackUrl).protocol.replace(':', ''))
    return `${proto}://${host}`
  }
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL
  }
  return new URL(fallbackUrl).origin
}
