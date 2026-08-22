'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ActivityUploader } from './activity-uploader'
import {
  SPORT_EMOJI,
  SPORT_LABELS,
  formatDistance,
  formatDuration,
  formatPace,
  timeAgo,
} from '@/lib/utils'

interface ActivityRow {
  id: string
  sport_type: string
  source: string
  started_at: string
  duration_s: number | null
  distance_m: number | null
  elevation_gain_m: number | null
  avg_hr_bpm: number | null
  avg_pace_s_per_km: number | null
  avg_cadence_rpm: number | null
  training_load: number | null
  notes: string | null
}

const SPORTS = ['all', 'run', 'football', 'gym', 'cycle', 'other']

export function ActivitiesView({ initialActivities }: { initialActivities: ActivityRow[] }) {
  const [showUpload, setShowUpload] = useState(false)
  const [filter, setFilter] = useState('all')

  const activities =
    filter === 'all'
      ? initialActivities
      : initialActivities.filter((a) => a.sport_type === filter)

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-4xl">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-[var(--foreground)]">Activities</h1>
        <Button onClick={() => setShowUpload((s) => !s)}>
          {showUpload ? 'Close' : 'Upload'}
        </Button>
      </div>

      {showUpload && (
        <Card>
          <CardContent className="pt-6">
            <ActivityUploader onDone={() => setShowUpload(false)} />
          </CardContent>
        </Card>
      )}

      {/* Sport filter */}
      <div className="flex gap-1.5 flex-wrap">
        {SPORTS.map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={
              'rounded-full border px-3 py-1 text-xs font-medium transition-colors ' +
              (filter === s
                ? 'border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)]'
                : 'border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--muted)]')
            }
          >
            {s === 'all' ? 'All' : (SPORT_EMOJI[s] ?? '') + ' ' + (SPORT_LABELS[s] ?? s)}
          </button>
        ))}
      </div>

      {/* Feed */}
      {!activities.length ? (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center">
            <p className="text-sm text-[var(--muted-foreground)]">
              {filter === 'all'
                ? 'No activities yet. Upload a .FIT, .GPX, or .TCX file to get started.'
                : `No ${SPORT_LABELS[filter] ?? filter} activities.`}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {activities.map((a) => (
            <Link key={a.id} href={`/activities/${a.id}`}>
              <Card className="hover:bg-[var(--muted)]/40 transition-colors cursor-pointer">
                <CardContent className="py-3 px-4 flex items-center gap-3">
                  <span className="text-2xl shrink-0" aria-hidden>
                    {SPORT_EMOJI[a.sport_type] ?? '🏅'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">
                        {SPORT_LABELS[a.sport_type] ?? a.sport_type}
                      </span>
                      <span className="text-xs text-[var(--muted-foreground)]">
                        {timeAgo(a.started_at)}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-[var(--muted-foreground)] flex-wrap">
                      {a.distance_m ? <span>{formatDistance(a.distance_m)}</span> : null}
                      {a.duration_s ? <span>{formatDuration(a.duration_s)}</span> : null}
                      {a.avg_pace_s_per_km ? <span>{formatPace(a.avg_pace_s_per_km)}</span> : null}
                      {a.avg_hr_bpm ? <span>{a.avg_hr_bpm} bpm</span> : null}
                    </div>
                  </div>
                  {a.training_load ? (
                    <Badge variant="secondary" className="shrink-0 text-xs">
                      Load {Math.round(a.training_load)}
                    </Badge>
                  ) : null}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
