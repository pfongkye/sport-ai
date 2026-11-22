'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { http } from '@/lib/http'
import { addDays } from '@/lib/plan/dates'
import { orderDayItems, type PlanActivity } from '@/lib/plan/day-items'
import type { StravaSyncStatus } from '@/lib/plan/sync-day'
import { currentWeekIndex, groupByWeek } from '@/lib/plan/group-weeks'
import type { ActivePlan } from '@/lib/plan/load-plan'
import { GeneratePlanForm } from './generate-plan-form'
import { PlanRecap } from './plan-recap'
import { ActivityCard } from './activity-card'
import { SessionCard } from './session-card'
import { useLocale, useT } from '@/lib/i18n/client'
import type { TFunction } from '@/lib/i18n/translate'
import type { Locale } from '@/lib/i18n/locales'
import { dayLabel, prefillGoalDate, weekLabel } from './plan-format'

function syncMessage(date: string, strava: StravaSyncStatus, imported: number, t: TFunction, locale: Locale): string {
  const day = dayLabel(date, locale)
  if (strava === 'rate_limited') return t('plan.syncRateLimited')
  if (strava === 'unauthorized') return t('plan.syncUnauthorized')
  if (strava === 'athlete_limit') return t('plan.syncAthleteLimit')
  if (strava === 'error') return t('plan.syncError')
  if (imported > 0) return t(imported === 1 ? 'plan.syncedOne' : 'plan.syncedMany', { day, n: imported })
  return t(strava === 'not_connected' ? 'plan.syncNotConnected' : 'plan.syncNone', { day })
}

interface Props {
  active: ActivePlan | null
  defaultGoal: string
}

function ChevronIcon({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={direction === 'left' ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6'} />
    </svg>
  )
}

/**
 * Week-grouped plan calendar. Mobile-first: one week at a time, days stacked in
 * a single column on a phone; 2 columns from `sm`, 4 columns from `lg`, 7 from `2xl`.
 * Week navigation uses 44px buttons (no horizontal scroll, no clipped cells).
 */
export function PlanView({ active, defaultGoal }: Props) {
  const router = useRouter()
  const t = useT()
  const locale = useLocale()
  const [announce, setAnnounce] = useState('')
  const [note, setNote] = useState('')
  const [showRegenerate, setShowRegenerate] = useState(false)
  const [syncing, setSyncing] = useState<string | null>(null)

  const weeks = useMemo(
    () => (active ? groupByWeek(active.sessions, active.plan.start_date, active.plan.end_date) : []),
    [active]
  )
  // Chosen week; null = follow "the week containing today" until the user navigates.
  const [picked, setPicked] = useState<number | null>(null)

  if (!active) {
    return (
      <div className="flex flex-col items-center text-center gap-4 py-8">
        <p className="text-4xl" aria-hidden>
          📅
        </p>
        <div>
          <h2 className="text-lg font-semibold text-[var(--foreground)]">{t('plan.noPlan')}</h2>
          <p className="text-sm text-[var(--muted-foreground)] mt-1 max-w-sm">
            {t('plan.noPlanHelp')}
          </p>
        </div>
        <GeneratePlanForm
          defaultGoal={defaultGoal}
          replacing={false}
          onDone={(m, n) => {
            setAnnounce(n ? `${m} ${n}` : m)
            setNote(n ?? '')
          }}
        />
        <p role="status" className="sr-only">
          {announce}
        </p>
      </div>
    )
  }

  const { plan, today, timezone } = active
  const activitiesByDate = new Map<string, PlanActivity[]>()
  for (const a of active.activities ?? []) {
    activitiesByDate.set(a.local_date, [...(activitiesByDate.get(a.local_date) ?? []), a])
  }

  async function syncDay(date: string) {
    setSyncing(date)
    try {
      const res = await http(`/api/plan/days/${date}/sync`, { method: 'POST' })
      const json = (await res.json().catch(() => ({}))) as {
        error?: string
        strava?: StravaSyncStatus
        imported?: number
      }
      if (!res.ok) {
        setAnnounce(json.error ?? t('plan.syncFailed'))
        return
      }
      setAnnounce(syncMessage(date, json.strava ?? 'error', json.imported ?? 0, t, locale))
      router.refresh()
    } catch {
      setAnnounce(t('plan.syncFailed'))
    } finally {
      setSyncing(null)
    }
  }
  const defaultIdx = currentWeekIndex(weeks, today)
  const idx = Math.min(Math.max(picked ?? defaultIdx, 0), Math.max(weeks.length - 1, 0))
  const week = weeks[idx]
  const minDate = today > plan.start_date ? today : plan.start_date

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-[var(--foreground)] break-words">{plan.title}</h2>
          <p className="text-sm text-[var(--muted-foreground)]">
            {dayLabel(plan.start_date, locale)} → {dayLabel(plan.end_date, locale)}
            {plan.goal ? ` · ${plan.goal}` : ''}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="min-h-11 sm:shrink-0"
          aria-expanded={showRegenerate}
          onClick={() => setShowRegenerate((v) => !v)}
        >
          {showRegenerate ? t('common.close') : t('plan.regenerate')}
        </Button>
      </div>

      {showRegenerate && (
        <div className="rounded-lg border border-[var(--border)] p-4">
          <GeneratePlanForm
            defaultGoal={plan.goal ?? defaultGoal}
            defaultConstraints={plan.constraints}
            defaultGoalDate={prefillGoalDate(plan.end_date, today)}
            replacing
            onDone={(m, n) => {
              setAnnounce(n ? `${m} ${n}` : m)
              setNote(n ?? '')
              setShowRegenerate(false)
              setPicked(null)
            }}
          />
        </div>
      )}

      <p role="status" aria-live="polite" className="sr-only">
        {announce}
      </p>
      {note && <p className="text-xs text-[var(--muted-foreground)]">{note}</p>}

      <PlanRecap recap={plan.recap} />
      {week && (
        <section aria-label={t('plan.calendar')} className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              className="min-h-11 min-w-11"
              disabled={idx <= 0}
              onClick={() => setPicked(idx - 1)}
              aria-label={t('plan.prevWeek')}
            >
              <ChevronIcon direction="left" />
            </Button>
            <div className="text-center">
              <p className="text-sm font-semibold text-[var(--foreground)]" aria-live="polite">
                {t('plan.weekOf', { n: idx + 1, total: weeks.length })}
              </p>
              <p className="text-xs text-[var(--muted-foreground)]">
                {weekLabel(week.weekStart, addDays(week.weekStart, 6), locale)}
              </p>
              {idx !== defaultIdx && (
                <button
                  type="button"
                  className="min-h-11 px-3 text-xs font-medium text-[var(--primary)] underline-offset-4 hover:underline"
                  onClick={() => setPicked(null)}
                >
                  {t('plan.jumpToThisWeek')}
                </button>
              )}
            </div>
            <Button
              type="button"
              variant="outline"
              className="min-h-11 min-w-11"
              disabled={idx >= weeks.length - 1}
              onClick={() => setPicked(idx + 1)}
              aria-label={t('plan.nextWeek')}
            >
              <ChevronIcon direction="right" />
            </Button>
          </div>

          <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7 short-landscape:grid-cols-2">
            {week.days.map((day) => {
              const isToday = day.date === today
              const items = orderDayItems(activitiesByDate.get(day.date) ?? [], day.sessions)
              return (
                <li
                  key={day.date}
                  aria-label={dayLabel(day.date, locale)}
                  className={cn(
                    'rounded-lg border p-2 space-y-2 min-w-0',
                    isToday
                      ? 'border-[var(--primary)] bg-[var(--accent)]/40'
                      : 'border-[var(--border)]'
                  )}
                >
                  <p className="text-xs font-semibold text-[var(--muted-foreground)] flex items-center gap-2">
                    {dayLabel(day.date, locale)}
                    {isToday && <span className="text-[var(--primary)]">{t('plan.today')}</span>}
                  </p>
                  {items.length === 0 ? (
                    <p className="text-xs text-[var(--muted-foreground)]">{t('plan.rest')}</p>
                  ) : (
                    items.map((item) =>
                      item.kind === 'activity' ? (
                        <ActivityCard key={item.activity.id} activity={item.activity} timezone={timezone} />
                      ) : (
                        <SessionCard
                          key={item.session.id}
                          session={item.session}
                          today={today}
                          minDate={minDate}
                          maxDate={plan.end_date}
                          onMoved={(m) => {
                            setAnnounce(m)
                            router.refresh()
                          }}
                          onDeleted={(m) => {
                            setAnnounce(m)
                            router.refresh()
                          }}
                        />
                      )
                    )
                  )}
                  {day.date <= today && (
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-11 w-full"
                      disabled={syncing !== null}
                      aria-label={t('plan.syncAria', { day: dayLabel(day.date, locale) })}
                      onClick={() => syncDay(day.date)}
                    >
                      {syncing === day.date ? t('plan.syncing') : t('plan.sync')}
                    </Button>
                  )}
                </li>
              )
            })}
          </ol>
        </section>
      )}
    </div>
  )
}
