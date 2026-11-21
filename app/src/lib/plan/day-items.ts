import { localDateInTz } from './dates'

/** A logged activity shown read-only on the plan calendar. */
export interface PlanActivity {
  id: string
  sport_type: string
  started_at: string
  duration_s: number | null
  distance_m: number | null
  avg_pace_s_per_km: number | null
  avg_hr_bpm: number | null
  source: string
  /** Athlete-local calendar date (YYYY-MM-DD) of `started_at`. */
  local_date: string
}

export type RawActivity = Omit<PlanActivity, 'local_date'>

/**
 * Assign each activity its athlete-local date, dropping activities already
 * linked to a planned session and those outside `window` (inclusive dates).
 */
export function bucketActivities(
  activities: RawActivity[],
  tz: string,
  linkedIds: Iterable<string>,
  window: { from: string; to: string }
): PlanActivity[] {
  const linked = new Set(linkedIds)
  const out: PlanActivity[] = []
  for (const a of activities) {
    if (linked.has(a.id)) continue
    const local_date = localDateInTz(new Date(a.started_at), tz)
    if (local_date < window.from || local_date > window.to) continue
    out.push({ ...a, local_date })
  }
  return out
}

/**
 * Order one day's items: completed activities (earliest first), then completed
 * sessions, then everything else in its original order.
 */
export function orderDayItems<S extends { status: string }>(
  activities: PlanActivity[],
  sessions: S[]
): Array<{ kind: 'activity'; activity: PlanActivity } | { kind: 'session'; session: S }> {
  const acts = [...activities].sort((a, b) => (a.started_at < b.started_at ? -1 : a.started_at > b.started_at ? 1 : 0))
  return [
    ...acts.map((activity) => ({ kind: 'activity' as const, activity })),
    ...sessions.filter((s) => s.status === 'completed').map((session) => ({ kind: 'session' as const, session })),
    ...sessions.filter((s) => s.status !== 'completed').map((session) => ({ kind: 'session' as const, session })),
  ]
}
