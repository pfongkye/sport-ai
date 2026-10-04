/**
 * Thin Strava API v3 client — token exchange, refresh, and activity fetching.
 *
 * This is a DATA integration (import activities), NOT login. Credentials come
 * from STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET (server env). All calls are
 * server-side only; never ship the client secret to the browser.
 *
 * Docs: https://developers.strava.com/docs/reference/
 */

const STRAVA_OAUTH_BASE = 'https://www.strava.com/oauth'
const STRAVA_API_BASE = 'https://www.strava.com/api/v3'

/** Scopes we request — read activities (incl. private) so import is complete. */
export const STRAVA_SCOPE = 'read,activity:read_all'

export interface StravaTokenResponse {
  token_type: string
  access_token: string
  refresh_token: string
  expires_at: number // unix epoch seconds
  expires_in: number
  athlete?: StravaAthlete
}

export interface StravaAthlete {
  id: number
  username?: string | null
  firstname?: string | null
  lastname?: string | null
}

/** Subset of a Strava SummaryActivity we care about. */
export interface StravaActivity {
  id: number
  name: string
  type: string // legacy type e.g. "Run"
  sport_type?: string // newer field e.g. "TrailRun"
  start_date: string // ISO 8601 UTC
  start_date_local?: string
  elapsed_time: number // seconds
  moving_time: number // seconds
  distance: number // meters
  total_elevation_gain?: number // meters
  average_heartrate?: number
  max_heartrate?: number
  average_cadence?: number // rpm (Strava reports per-leg for runs)
  average_speed?: number // m/s
  calories?: number
  has_heartrate?: boolean
  manual?: boolean
  trainer?: boolean
}

export interface StravaStreamSet {
  // Each key present only if requested & available.
  time?: { data: number[] }
  latlng?: { data: [number, number][] }
  heartrate?: { data: number[] }
  cadence?: { data: number[] }
  altitude?: { data: number[] }
  watts?: { data: (number | null)[] }
  velocity_smooth?: { data: number[] } // m/s, used to derive pace
}

function requireCreds(): { clientId: string; clientSecret: string } {
  const clientId = process.env.STRAVA_CLIENT_ID
  const clientSecret = process.env.STRAVA_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error(
      'Strava is not configured. Set STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET.'
    )
  }
  return { clientId, clientSecret }
}

/** Build the Strava authorize URL the browser is redirected to. */
export function buildAuthorizeUrl(redirectUri: string, state: string): string {
  const { clientId } = requireCreds()
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    approval_prompt: 'auto',
    scope: STRAVA_SCOPE,
    state,
  })
  return `${STRAVA_OAUTH_BASE}/authorize?${params.toString()}`
}

/** Exchange an authorization code for tokens (first connect). */
export async function exchangeCodeForToken(code: string): Promise<StravaTokenResponse> {
  const { clientId, clientSecret } = requireCreds()
  const res = await fetch(`${STRAVA_OAUTH_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
    }),
  })
  if (!res.ok) {
    throw new Error(`Strava token exchange failed (${res.status}): ${await res.text()}`)
  }
  return (await res.json()) as StravaTokenResponse
}

/** Refresh an expired access token using the stored refresh token. */
export async function refreshAccessToken(refreshToken: string): Promise<StravaTokenResponse> {
  const { clientId, clientSecret } = requireCreds()
  const res = await fetch(`${STRAVA_OAUTH_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) {
    throw new Error(`Strava token refresh failed (${res.status}): ${await res.text()}`)
  }
  return (await res.json()) as StravaTokenResponse
}

/**
 * List the athlete's activities (most recent first).
 * `page`/`perPage` map to Strava's pagination; `before`/`after` are unix epoch
 * seconds for incremental sync.
 */
export async function listActivities(
  accessToken: string,
  opts: { page?: number; perPage?: number; before?: number; after?: number } = {}
): Promise<StravaActivity[]> {
  const params = new URLSearchParams({
    page: String(opts.page ?? 1),
    per_page: String(opts.perPage ?? 30),
  })
  if (opts.before) params.set('before', String(opts.before))
  if (opts.after) params.set('after', String(opts.after))

  const res = await fetch(`${STRAVA_API_BASE}/athlete/activities?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (res.status === 401) throw new Error('STRAVA_UNAUTHORIZED')
  if (res.status === 429) throw new Error('STRAVA_RATE_LIMITED')
  if (!res.ok) {
    throw new Error(`Strava listActivities failed (${res.status}): ${await res.text()}`)
  }
  return (await res.json()) as StravaActivity[]
}

/** Fetch one detailed activity (adds calories, description, etc.). */
export async function getActivity(
  accessToken: string,
  activityId: number
): Promise<StravaActivity> {
  const res = await fetch(`${STRAVA_API_BASE}/activities/${activityId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (res.status === 401) throw new Error('STRAVA_UNAUTHORIZED')
  if (res.status === 429) throw new Error('STRAVA_RATE_LIMITED')
  if (!res.ok) {
    throw new Error(`Strava getActivity failed (${res.status}): ${await res.text()}`)
  }
  return (await res.json()) as StravaActivity
}

/**
 * Fetch stream data for an activity. Returns a keyed object (not the raw array
 * form) via `key_by_type=true`. Best-effort: returns {} on any failure so an
 * import still succeeds with summary metrics only.
 */
export async function getActivityStreams(
  accessToken: string,
  activityId: number
): Promise<StravaStreamSet> {
  const keys = 'time,latlng,heartrate,cadence,altitude,watts,velocity_smooth'
  const url = `${STRAVA_API_BASE}/activities/${activityId}/streams?keys=${keys}&key_by_type=true`
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return {}
    return (await res.json()) as StravaStreamSet
  } catch {
    return {}
  }
}
