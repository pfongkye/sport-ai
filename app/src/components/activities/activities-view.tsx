'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ActivityUploader } from './activity-uploader'
import { AddActivityByVoice } from './add-activity-by-voice'
import { StravaImportPanel } from '@/components/strava/strava-import-panel'
import { useLocale, useT } from '@/lib/i18n/client'
import { sportLabel } from '@/lib/i18n/labels'
import {
  SPORT_EMOJI,
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
  const t = useT()
  const locale = useLocale()
  const [showUpload, setShowUpload] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [showStrava, setShowStrava] = useState(false)
  const [filter, setFilter] = useState('all')

  const activities =
    filter === 'all'
      ? initialActivities
      : initialActivities.filter((a) => a.sport_type === filter)

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <h1 className="text-2xl font-bold text-[var(--foreground)]">{t('act.title')}</h1>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setShowAdd((s) => !s)
              setShowUpload(false)
              setShowStrava(false)
            }}
          >
            {showAdd ? t('common.close') : t('act.addByVoice')}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setShowStrava((s) => !s)
              setShowUpload(false)
              setShowAdd(false)
            }}
          >
            {showStrava ? t('common.close') : t('act.importStrava')}
          </Button>
          <Button
            onClick={() => {
              setShowUpload((s) => !s)
              setShowAdd(false)
              setShowStrava(false)
            }}
          >
            {showUpload ? t('common.close') : t('act.upload')}
          </Button>
        </div>
      </div>

      {showAdd && (
        <Card>
          <CardContent className="pt-6">
            <AddActivityByVoice onDone={() => setShowAdd(false)} />
          </CardContent>
        </Card>
      )}

      {showStrava && (
        <Card>
          <CardContent className="pt-6">
            <StravaImportPanel />
          </CardContent>
        </Card>
      )}

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
            {s === 'all' ? t('act.all') : (SPORT_EMOJI[s] ?? '') + ' ' + sportLabel(t, s)}
          </button>
        ))}
      </div>

      {/* Feed */}
      {!activities.length ? (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center">
            <p className="text-sm text-[var(--muted-foreground)]">
              {filter === 'all' ? t('act.emptyAll') : t('act.emptySport', { sport: sportLabel(t, filter) })}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {activities.map((a) => (
            <Link key={a.id} href={`/activities/${a.id}`} className="block">
              <Card className="hover:bg-[var(--muted)]/40 transition-colors cursor-pointer">
                <CardContent className="py-3 px-4 flex items-center gap-3">
                  <span className="text-2xl shrink-0" aria-hidden>
                    {SPORT_EMOJI[a.sport_type] ?? '🏅'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">
                        {sportLabel(t, a.sport_type)}
                      </span>
                      <span className="text-xs text-[var(--muted-foreground)]">
                        {timeAgo(a.started_at, undefined, locale)}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-[var(--muted-foreground)] flex-wrap">
                      {a.distance_m ? <span>{formatDistance(a.distance_m, 'metric', locale)}</span> : null}
                      {a.duration_s ? <span>{formatDuration(a.duration_s)}</span> : null}
                      {a.avg_pace_s_per_km ? <span>{formatPace(a.avg_pace_s_per_km)}</span> : null}
                      {a.avg_hr_bpm ? <span>{a.avg_hr_bpm} bpm</span> : null}
                    </div>
                  </div>
                  {a.training_load ? (
                    <Badge variant="secondary" className="shrink-0 text-xs">
                      {t('act.load', { n: Math.round(a.training_load) })}
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
