/**
 * Resolve the public origin of the app behind a proxy/tunnel.
 *
 * Same concern as the auth callback (AGENTS.md #14): request.url reflects the
 * internal host (localhost:3000) behind ngrok/Cloud Run, so Strava redirect
 * URIs must be built from the forwarded host (or NEXT_PUBLIC_APP_URL) instead.
 */
export function resolvePublicOrigin(request: Request): string {
  const forwardedHost = request.headers.get('x-forwarded-host')
  const forwardedProto = request.headers.get('x-forwarded-proto') ?? 'https'
  if (forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`
  }
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL
  }
  return new URL(request.url).origin
}

/** The fixed Strava redirect path handled by our callback route. */
export const STRAVA_REDIRECT_PATH = '/api/integrations/strava/callback'

export function stravaRedirectUri(request: Request): string {
  return `${resolvePublicOrigin(request)}${STRAVA_REDIRECT_PATH}`
}
