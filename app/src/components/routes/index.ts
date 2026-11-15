/**
 * Reusable route-suggestion UI — the documented Phase-6 "plan" hook.
 *
 * Phase 6 (plan integration) is intentionally SKIPPED for now EXCEPT this
 * barrel. The /plan view (app/src/app/(app)/plan/page.tsx) is currently a STUB
 * with no session card, so NOTHING is wired into /plan today. This file is the
 * documented leave-behind only.
 *
 * HOW THE PLAN VIEW WILL USE THIS (one-way dependency: plan → routes; routes
 * never imports from plan):
 *   - Render `RouteSummary`, `ElevationProfile`, and the `RouteMap` (load it via
 *     `next/dynamic(() => import('@/components/routes/route-map'), { ssr: false })`
 *     — it touches window/WebGL) inside a long-run session card.
 *   - To attach a route to a planned long-run session, POST to
 *     `/api/routes/suggest` with:
 *         { distanceKm, terrain, plannedSessionId, ... }
 *     where `distanceKm` comes from the session's `target_distance_m` (÷1000)
 *     and `plannedSessionId` is the session id. The API verifies ownership,
 *     links the cached `suggested_routes` row to the session, and returns the
 *     full RouteResult to render with the components below.
 *
 * RouteSuggester (the standalone /routes controls) is intentionally NOT exported
 * here — it is page-specific. The plan view composes its own controls around
 * these presentational pieces.
 */

export { default as RouteMap } from './route-map'
export { ElevationProfile } from './elevation-profile'
export { RouteSummary } from './route-summary'
export type { RouteSummaryProps } from './route-summary'
