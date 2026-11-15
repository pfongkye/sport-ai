/**
 * ORS quota visibility. The public ORS API reports its daily/minute quota in
 * `X-RateLimit-*` response headers. We log a single structured line when the
 * remaining quota is low (or exhausted on 429) so a Cloud Logging log-based
 * alert on the `[ors-quota]` prefix can notify the owner. A self-hosted ORS
 * (ORS_BASE_URL) sends no such headers, so nothing is logged.
 *
 * SECURITY: logs only numbers and the endpoint label. Never coordinates or key.
 */

import { getOrsQuotaWarnPct } from './config'

export const ORS_QUOTA_PREFIX = '[ors-quota]'

export interface OrsQuota {
  limit: number
  remaining: number
  /** Raw X-RateLimit-Reset value (ORS sends epoch seconds or a delta), or null. */
  reset: string | null
}

/** Parse the rate-limit headers. Returns null when limit/remaining are absent or not numeric. */
export function parseOrsQuota(headers: Pick<Headers, 'get'>): OrsQuota | null {
  const limit = Number(headers.get('x-ratelimit-limit'))
  const remainingRaw = headers.get('x-ratelimit-remaining')
  const remaining = Number(remainingRaw)
  if (!headers.get('x-ratelimit-limit') || remainingRaw === null) return null
  if (!Number.isFinite(limit) || !Number.isFinite(remaining) || limit <= 0 || remaining < 0) {
    return null
  }
  return { limit, remaining, reset: headers.get('x-ratelimit-reset') }
}

/**
 * Inspect a response from ORS and log when quota is low or exhausted.
 * `endpoint` is a fixed label ('directions' | 'geocode'), never user input.
 */
export function reportOrsQuota(
  endpoint: 'directions' | 'geocode',
  status: number,
  headers: Pick<Headers, 'get'> | null | undefined
): void {
  // Observability must never break a routing request.
  if (!headers || typeof headers.get !== 'function') {
    if (status === 429) console.error(`${ORS_QUOTA_PREFIX} exhausted endpoint=${endpoint}`)
    return
  }
  const quota = parseOrsQuota(headers)
  const resetPart = quota?.reset ? ` reset=${quota.reset}` : ''
  if (status === 429) {
    const detail = quota ? ` limit=${quota.limit} remaining=${quota.remaining}${resetPart}` : ''
    console.error(`${ORS_QUOTA_PREFIX} exhausted endpoint=${endpoint}${detail}`)
    return
  }
  if (!quota) return
  const pct = (quota.remaining / quota.limit) * 100
  if (pct <= getOrsQuotaWarnPct()) {
    console.warn(
      `${ORS_QUOTA_PREFIX} low endpoint=${endpoint} remaining=${quota.remaining} limit=${quota.limit} pct=${pct.toFixed(1)}${resetPart}`
    )
  }
}
