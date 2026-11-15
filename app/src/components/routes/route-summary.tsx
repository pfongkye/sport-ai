/**
 * Presentational, honest summary of a suggested route. Shows the ACTUAL route
 * distance alongside what was requested (ORS round-trips rarely hit the target
 * exactly), ascent/descent, terrain, and the start label. Reused by the /routes
 * page and exported for the plan hook (see components/routes/index.ts). Also
 * doubles as the screen-reader alternative to the map.
 *
 * No hover-only affordances (gotcha #23): everything is plain, visible text.
 */

import { formatDistance } from '@/lib/utils'

export interface RouteSummaryProps {
  requestedDistanceM: number
  distanceM: number
  ascentM: number
  descentM: number
  terrain: 'flat' | 'uphill'
  startLabel?: string | null
  /** Optional caller note, e.g. a honest caveat about the distance match. */
  note?: string | null
  /** False = the closest loop found is outside the distance tolerance. Undefined = unknown. */
  distanceWithinTolerance?: boolean
}

const TERRAIN_LABEL: Record<'flat' | 'uphill', string> = {
  flat: 'Flatter route',
  uphill: 'Hillier route',
}

export function RouteSummary({
  requestedDistanceM,
  distanceM,
  ascentM,
  descentM,
  terrain,
  startLabel,
  note,
  distanceWithinTolerance,
}: RouteSummaryProps) {
  const stats: { label: string; value: string }[] = [
    { label: 'Distance', value: formatDistance(distanceM) },
    { label: 'Requested', value: formatDistance(requestedDistanceM) },
    { label: 'Ascent (est.)', value: `${Math.round(ascentM)} m` },
    { label: 'Descent (est.)', value: `${Math.round(descentM)} m` },
  ]

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center rounded-full bg-[var(--muted)] px-2.5 py-1 text-xs font-medium text-[var(--foreground)]">
          {TERRAIN_LABEL[terrain]}
        </span>
        {startLabel && (
          <span className="text-sm text-[var(--muted-foreground)]">from {startLabel}</span>
        )}
      </div>

      <dl className="grid grid-cols-2 sm:grid-cols-4 short-landscape:grid-cols-2 gap-3">
        {stats.map((s) => (
          <div key={s.label}>
            <dt className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
              {s.label}
            </dt>
            <dd className="text-base font-semibold mt-0.5">{s.value}</dd>
          </div>
        ))}
      </dl>

      {distanceWithinTolerance === false && (
        <p className="text-sm font-medium text-[var(--foreground)]">
          Closest loop found: {formatDistance(distanceM)} (requested{' '}
          {formatDistance(requestedDistanceM)})
        </p>
      )}

      {note && <p className="text-xs text-[var(--muted-foreground)]">{note}</p>}
    </div>
  )
}
