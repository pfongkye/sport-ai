/**
 * OpenRouteService (ORS) configuration — SERVER-ONLY.
 *
 * `ORS_API_KEY` is a secret: never ship it to the browser (no NEXT_PUBLIC_ name)
 * and never log it. `ORS_BASE_URL` is endpoint-configurable so pointing at a
 * self-hosted ORS instance is a pure env swap (default is the public API).
 */

/** Base URL for the ORS API. Defaults to the public hosted API. */
export const ORS_BASE_URL = process.env.ORS_BASE_URL || 'https://api.openrouteservice.org'

/**
 * Read the ORS API key from the server environment. Returns null when unset so
 * callers can surface the owner-fixable "routing isn't configured" message
 * instead of crashing. Never log the returned value.
 */
export function getOrsApiKey(): string | null {
  return process.env.ORS_API_KEY || null
}

/** Per-ORS-call timeout. Keeps request latency bounded (Req 7.2). */
export const ORS_TIMEOUT_MS = 8000

/** Max round-trip seeds we try per suggestion (cost/latency cap). */
export const MAX_SEEDS = 3

/**
 * Warn when the remaining ORS quota (X-RateLimit-Remaining / X-RateLimit-Limit)
 * drops to this percentage or below. Default 10. Invalid values fall back to 10.
 */
export function getOrsQuotaWarnPct(): number {
  const raw = Number(process.env.ORS_QUOTA_WARN_PCT)
  return Number.isFinite(raw) && raw >= 0 && raw <= 100 && process.env.ORS_QUOTA_WARN_PCT ? raw : 10
}
