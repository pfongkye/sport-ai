import { resolvePublicOrigin as resolveOrigin } from '@/lib/public-origin'

/** Public origin of the app behind a proxy/tunnel (see lib/public-origin.ts, AGENTS.md #14). */
export function resolvePublicOrigin(request: Request): string {
  return resolveOrigin(request.headers, request.url)
}

/** The fixed Strava redirect path handled by our callback route. */
export const STRAVA_REDIRECT_PATH = '/api/integrations/strava/callback'

export function stravaRedirectUri(request: Request): string {
  return `${resolvePublicOrigin(request)}${STRAVA_REDIRECT_PATH}`
}
