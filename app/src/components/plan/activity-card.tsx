import Link from 'next/link'
import type { PlanActivity } from '@/lib/plan/day-items'
import { Badge } from '@/components/ui/badge'
import { formatDistance, formatDuration, formatPace, SPORT_EMOJI, SPORT_LABELS } from '@/lib/utils'

function CheckCircleIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-green-600 dark:text-green-400"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  )
}

interface Props {
  activity: PlanActivity
  /** Athlete IANA zone, used for the time of day. */
  timezone: string
}

/** A logged activity on its day. Read-only: no move or delete controls. */
export function ActivityCard({ activity, timezone }: Props) {
  const label = SPORT_LABELS[activity.sport_type] ?? activity.sport_type
  const time = new Date(activity.started_at).toLocaleTimeString('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
  })
  const stats = [
    activity.distance_m ? formatDistance(activity.distance_m) : null,
    activity.duration_s ? formatDuration(Math.round(activity.duration_s)) : null,
    activity.sport_type === 'run' && activity.avg_pace_s_per_km
      ? formatPace(Math.round(activity.avg_pace_s_per_km))
      : null,
    activity.avg_hr_bpm ? `${Math.round(activity.avg_hr_bpm)} bpm` : null,
  ].filter(Boolean)

  return (
    <div
      data-testid="activity-card"
      className="rounded-lg border border-[var(--border)] border-l-4 border-l-green-500 bg-green-500/5 p-3 space-y-2"
    >
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-sm font-semibold text-[var(--foreground)] min-w-0 break-words flex items-center gap-1.5">
          <CheckCircleIcon />
          <span aria-hidden>{SPORT_EMOJI[activity.sport_type] ?? SPORT_EMOJI.other}</span>
          <span>{label}</span>
        </h4>
        <Badge variant="success" className="shrink-0">
          Completed
        </Badge>
      </div>
      <p className="text-xs text-[var(--muted-foreground)]">{time}</p>
      {stats.length > 0 && <p className="text-sm text-[var(--foreground)]">{stats.join(' · ')}</p>}
      <Link
        href={`/activities/${activity.id}`}
        className="inline-flex min-h-11 items-center text-sm font-medium text-[var(--primary)] underline-offset-4 hover:underline"
      >
        View activity
      </Link>
    </div>
  )
}
