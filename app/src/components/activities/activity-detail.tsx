'use client'

import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { useState } from 'react'
import { http } from '@/lib/http'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { MetricsChart } from './metrics-chart'
import { ActivityInsight } from './activity-insight'
import {
  SPORT_EMOJI,
  SPORT_LABELS,
  formatDate,
  formatDistance,
  formatDuration,
  formatPace,
} from '@/lib/utils'
import type { Activity } from '@/types/database'

// Leaflet touches window — load client-only, no SSR.
const ActivityMap = dynamic(() => import('./activity-map'), {
  ssr: false,
  loading: () => (
    <div className="h-[320px] w-full rounded-lg bg-[var(--muted)] animate-pulse" />
  ),
})

interface StreamRow {
  stream_type: string
  data: { t: number; v: number | [number, number] }[]
}

export function ActivityDetail({
  activity,
  streams,
}: {
  activity: Activity
  streams: StreamRow[]
}) {
  const router = useRouter()
  const [deleting, setDeleting] = useState(false)

  const streamByType = new Map(streams.map((s) => [s.stream_type, s.data]))
  const latlng = streamByType.get('latlng') as { t: number; v: [number, number] }[] | undefined
  const path: [number, number][] = latlng?.map((p) => p.v) ?? []

  async function handleDelete() {
    if (!confirm('Delete this activity? This cannot be undone.')) return
    setDeleting(true)
    const res = await http(`/api/activities/${activity.id}`, { method: 'DELETE' })
    if (res.ok) {
      router.push('/activities')
      router.refresh()
    } else {
      setDeleting(false)
      alert('Failed to delete activity.')
    }
  }

  const stats: { label: string; value: string }[] = []
  if (activity.distance_m) stats.push({ label: 'Distance', value: formatDistance(activity.distance_m) })
  if (activity.duration_s) stats.push({ label: 'Duration', value: formatDuration(activity.duration_s) })
  if (activity.avg_pace_s_per_km) stats.push({ label: 'Avg Pace', value: formatPace(activity.avg_pace_s_per_km) })
  if (activity.avg_hr_bpm) stats.push({ label: 'Avg HR', value: `${activity.avg_hr_bpm} bpm` })
  if (activity.max_hr_bpm) stats.push({ label: 'Max HR', value: `${activity.max_hr_bpm} bpm` })
  if (activity.avg_cadence_rpm) stats.push({ label: 'Avg Cadence', value: `${activity.avg_cadence_rpm} spm` })
  if (activity.elevation_gain_m) stats.push({ label: 'Elevation', value: `${Math.round(activity.elevation_gain_m)} m` })
  if (activity.calories_kcal) stats.push({ label: 'Calories', value: `${activity.calories_kcal} kcal` })
  if (activity.training_load) stats.push({ label: 'Training Load', value: `${Math.round(activity.training_load)}` })

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-4xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="text-3xl" aria-hidden>
            {SPORT_EMOJI[activity.sport_type] ?? '🏅'}
          </span>
          <div>
            <h1 className="text-xl font-bold text-[var(--foreground)]">
              {SPORT_LABELS[activity.sport_type] ?? activity.sport_type}
              {activity.notes ? ` — ${activity.notes}` : ''}
            </h1>
            <p className="text-sm text-[var(--muted-foreground)]">
              {formatDate(activity.started_at, 'long')}
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={handleDelete} disabled={deleting}>
          {deleting ? 'Deleting…' : 'Delete'}
        </Button>
      </div>

      {/* Stats grid */}
      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {stats.map((s) => (
              <div key={s.label}>
                <p className="text-xs text-[var(--muted-foreground)] uppercase tracking-wide">
                  {s.label}
                </p>
                <p className="text-lg font-semibold mt-0.5">{s.value}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* AI coach insight */}
      <ActivityInsight activityId={activity.id} />

      {/* Map */}
      {path.length > 1 && (
        <Card>
          <CardContent className="pt-6">
            <ActivityMap path={path} />
          </CardContent>
        </Card>
      )}

      {/* Charts */}
      <Card>
        <CardContent className="pt-6 space-y-6">
          <MetricsChart
            title="Heart Rate"
            points={(streamByType.get('heartrate') as { t: number; v: number }[]) ?? []}
            color="#ef4444"
            kind="hr"
            unit=""
          />
          <MetricsChart
            title="Pace"
            points={(streamByType.get('pace') as { t: number; v: number }[]) ?? []}
            color="#f97316"
            kind="pace"
          />
          <MetricsChart
            title="Cadence"
            points={(streamByType.get('cadence') as { t: number; v: number }[]) ?? []}
            color="#8b5cf6"
            kind="cadence"
            unit=""
          />
          <MetricsChart
            title="Elevation"
            points={(streamByType.get('altitude') as { t: number; v: number }[]) ?? []}
            color="#3b82f6"
            kind="altitude"
            unit=" m"
          />
          <MetricsChart
            title="Power"
            points={(streamByType.get('power') as { t: number; v: number }[]) ?? []}
            color="#eab308"
            kind="power"
            unit=" W"
          />
        </CardContent>
      </Card>
    </div>
  )
}
