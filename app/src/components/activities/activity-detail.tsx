'use client'

import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { useState } from 'react'
import { http } from '@/lib/http'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { MetricsChart } from './metrics-chart'
import { ActivityInsight } from './activity-insight'
import { SessionNotes } from './session-notes'
import { useLocale, useT } from '@/lib/i18n/client'
import { sportLabel } from '@/lib/i18n/labels'
import {
  SPORT_EMOJI,
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
  timeZone,
}: {
  activity: Activity
  streams: StreamRow[]
  /** Athlete's IANA zone, so server and client render the same day. */
  timeZone?: string
}) {
  const router = useRouter()
  const t = useT()
  const locale = useLocale()
  const [deleting, setDeleting] = useState(false)

  const streamByType = new Map(streams.map((s) => [s.stream_type, s.data]))
  const latlng = streamByType.get('latlng') as { t: number; v: [number, number] }[] | undefined
  const path: [number, number][] = latlng?.map((p) => p.v) ?? []

  async function handleDelete() {
    if (!confirm(t('act.deleteConfirm'))) return
    setDeleting(true)
    const res = await http(`/api/activities/${activity.id}`, { method: 'DELETE' })
    if (res.ok) {
      router.push('/activities')
      router.refresh()
    } else {
      setDeleting(false)
      alert(t('act.deleteFailed'))
    }
  }

  const stats: { label: string; value: string }[] = []
  if (activity.distance_m) stats.push({ label: t('act.stat.distance'), value: formatDistance(activity.distance_m, 'metric', locale) })
  if (activity.duration_s) stats.push({ label: t('act.stat.duration'), value: formatDuration(activity.duration_s) })
  if (activity.avg_pace_s_per_km) stats.push({ label: t('act.stat.avgPace'), value: formatPace(activity.avg_pace_s_per_km) })
  if (activity.avg_hr_bpm) stats.push({ label: t('act.stat.avgHr'), value: `${activity.avg_hr_bpm} bpm` })
  if (activity.max_hr_bpm) stats.push({ label: t('act.stat.maxHr'), value: `${activity.max_hr_bpm} bpm` })
  if (activity.avg_cadence_rpm) stats.push({ label: t('act.stat.avgCadence'), value: `${activity.avg_cadence_rpm} spm` })
  if (activity.elevation_gain_m) stats.push({ label: t('act.stat.elevation'), value: `${Math.round(activity.elevation_gain_m)} m` })
  if (activity.calories_kcal) stats.push({ label: t('act.stat.calories'), value: `${activity.calories_kcal} kcal` })
  if (activity.training_load) stats.push({ label: t('act.stat.load'), value: `${Math.round(activity.training_load)}` })

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
              {sportLabel(t, activity.sport_type)}
              {activity.notes ? ` · ${activity.notes}` : ''}
            </h1>
            <p className="text-sm text-[var(--muted-foreground)]">
              {formatDate(activity.started_at, 'long', timeZone, locale)}
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={handleDelete} disabled={deleting}>
          {deleting ? t('act.deleting') : t('act.delete')}
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

      {/* Session notes (subjective, voice or text) */}
      <SessionNotes activityId={activity.id} />

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
            title={t('act.chart.hr')}
            points={(streamByType.get('heartrate') as { t: number; v: number }[]) ?? []}
            color="#ef4444"
            kind="hr"
            unit=""
          />
          <MetricsChart
            title={t('act.chart.pace')}
            points={(streamByType.get('pace') as { t: number; v: number }[]) ?? []}
            color="#f97316"
            kind="pace"
          />
          <MetricsChart
            title={t('act.chart.cadence')}
            points={(streamByType.get('cadence') as { t: number; v: number }[]) ?? []}
            color="#8b5cf6"
            kind="cadence"
            unit=""
          />
          <MetricsChart
            title={t('act.chart.elevation')}
            points={(streamByType.get('altitude') as { t: number; v: number }[]) ?? []}
            color="#3b82f6"
            kind="altitude"
            unit=" m"
          />
          <MetricsChart
            title={t('act.chart.power')}
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
