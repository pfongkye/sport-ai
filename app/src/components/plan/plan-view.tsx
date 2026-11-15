'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { addDays } from '@/lib/plan/dates'
import { currentWeekIndex, groupByWeek } from '@/lib/plan/group-weeks'
import type { ActivePlan } from '@/lib/plan/load-plan'
import { GeneratePlanForm } from './generate-plan-form'
import { SessionCard } from './session-card'
import { dayLabel, weekLabel } from './plan-format'

interface Props {
  active: ActivePlan | null
  defaultGoal: string
}

/**
 * Week-grouped plan calendar. Mobile-first: one week at a time, days stacked in
 * a single column on a phone; 2 columns from `sm`, a 7-column week grid from
 * `lg`. Week navigation uses 44px buttons (no horizontal scroll, no clipped cells).
 */
export function PlanView({ active, defaultGoal }: Props) {
  const router = useRouter()
  const [announce, setAnnounce] = useState('')
  const [showRegenerate, setShowRegenerate] = useState(false)

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
          <h2 className="text-lg font-semibold text-[var(--foreground)]">No active plan yet</h2>
          <p className="text-sm text-[var(--muted-foreground)] mt-1 max-w-sm">
            Generate a periodized plan from your goal, training days and recent load.
          </p>
        </div>
        <GeneratePlanForm defaultGoal={defaultGoal} replacing={false} onDone={setAnnounce} />
        <p role="status" className="sr-only">
          {announce}
        </p>
      </div>
    )
  }

  const { plan, today } = active
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
            {dayLabel(plan.start_date)} → {dayLabel(plan.end_date)}
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
          {showRegenerate ? 'Close' : 'Regenerate plan'}
        </Button>
      </div>

      {showRegenerate && (
        <div className="rounded-lg border border-[var(--border)] p-4">
          <GeneratePlanForm
            defaultGoal={plan.goal ?? defaultGoal}
            replacing
            onDone={(m) => {
              setAnnounce(m)
              setShowRegenerate(false)
              setPicked(null)
            }}
          />
        </div>
      )}

      <p role="status" aria-live="polite" className="sr-only">
        {announce}
      </p>

      {week && (
        <section aria-label="Plan calendar" className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              className="min-h-11 min-w-11"
              disabled={idx <= 0}
              onClick={() => setPicked(idx - 1)}
              aria-label="Previous week"
            >
              ←
            </Button>
            <div className="text-center">
              <p className="text-sm font-semibold text-[var(--foreground)]" aria-live="polite">
                Week {idx + 1} of {weeks.length}
              </p>
              <p className="text-xs text-[var(--muted-foreground)]">
                {weekLabel(week.weekStart, addDays(week.weekStart, 6))}
              </p>
              {idx !== defaultIdx && (
                <button
                  type="button"
                  className="min-h-11 px-3 text-xs font-medium text-[var(--primary)] underline-offset-4 hover:underline"
                  onClick={() => setPicked(null)}
                >
                  Jump to this week
                </button>
              )}
            </div>
            <Button
              type="button"
              variant="outline"
              className="min-h-11 min-w-11"
              disabled={idx >= weeks.length - 1}
              onClick={() => setPicked(idx + 1)}
              aria-label="Next week"
            >
              →
            </Button>
          </div>

          <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-7 short-landscape:grid-cols-2">
            {week.days.map((day) => {
              const isToday = day.date === today
              return (
                <li
                  key={day.date}
                  aria-label={dayLabel(day.date)}
                  className={cn(
                    'rounded-lg border p-2 space-y-2 min-w-0',
                    isToday
                      ? 'border-[var(--primary)] bg-[var(--accent)]/40'
                      : 'border-[var(--border)]'
                  )}
                >
                  <p className="text-xs font-semibold text-[var(--muted-foreground)] flex items-center gap-2">
                    {dayLabel(day.date)}
                    {isToday && <span className="text-[var(--primary)]">Today</span>}
                  </p>
                  {day.sessions.length === 0 ? (
                    <p className="text-xs text-[var(--muted-foreground)]">Rest</p>
                  ) : (
                    day.sessions.map((s) => (
                      <SessionCard
                        key={s.id}
                        session={s}
                        today={today}
                        minDate={minDate}
                        maxDate={plan.end_date}
                        onMoved={(m) => {
                          setAnnounce(m)
                          router.refresh()
                        }}
                      />
                    ))
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
