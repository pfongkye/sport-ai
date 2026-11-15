'use client'

import { useId, useState } from 'react'
import Link from 'next/link'
import { http } from '@/lib/http'
import { isFutureAndPending } from '@/lib/plan/session-guard'
import type { PlanSessionRow } from '@/lib/plan/load-plan'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SESSION_TYPE_LABELS, SPORT_EMOJI, SPORT_LABELS } from '@/lib/utils'
import { dayLabel, targetSummary } from './plan-format'

const STATUS_BADGE: Record<
  PlanSessionRow['status'],
  { label: string; variant: 'secondary' | 'success' | 'warning' | 'info' }
> = {
  pending: { label: 'Planned', variant: 'secondary' },
  completed: { label: 'Done', variant: 'success' },
  skipped: { label: 'Skipped', variant: 'warning' },
  modified: { label: 'Moved/adjusted', variant: 'info' },
}

interface Props {
  session: PlanSessionRow
  today: string
  /** Earliest / latest date a session may be moved to (plan window, clamped to today). */
  minDate: string
  maxDate: string
  /** Called after a successful move with a screen-reader message. */
  onMoved: (message: string) => void
}

/**
 * One planned session. Future + pending sessions get a visible "Move" button
 * (44px target, never hover-only: gotcha #23) that opens an inline date picker.
 * Past/completed/skipped/modified sessions show no control. The server re-checks
 * the guard on PATCH (Req 2a.4); this check only decides whether to show the UI.
 */
export function SessionCard({ session, today, minDate, maxDate, onMoved }: Props) {
  const inputId = useId()
  const errorId = useId()
  const [moving, setMoving] = useState(false)
  const [date, setDate] = useState(session.scheduled_date)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canMove = isFutureAndPending(session, today)
  const badge = STATUS_BADGE[session.status]
  const typeLabel =
    SESSION_TYPE_LABELS[(session.session_type ?? '').toLowerCase()] ??
    session.session_type ??
    SPORT_LABELS[session.sport_type]
  const targets = targetSummary(session)

  async function submit() {
    if (!date || date === session.scheduled_date) {
      setError('Pick a different date.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await http(`/api/plan/sessions/${session.id}/reschedule`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setError(json.error ?? 'Could not move the session.')
        return
      }
      setMoving(false)
      onMoved(`${typeLabel} moved to ${dayLabel(date)}.`)
    } catch {
      setError('Network error. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <article
      className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3 space-y-2"
      aria-label={`${typeLabel}, ${dayLabel(session.scheduled_date)}, ${badge.label}`}
    >
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-sm font-semibold text-[var(--foreground)] min-w-0 break-words">
          <span aria-hidden>{SPORT_EMOJI[session.sport_type]} </span>
          {typeLabel}
        </h4>
        <Badge variant={badge.variant} className="shrink-0">
          {badge.label}
        </Badge>
      </div>
      {targets && <p className="text-sm text-[var(--foreground)]">{targets}</p>}
      {session.description && (
        <p className="text-xs text-[var(--muted-foreground)] break-words">{session.description}</p>
      )}
      {session.ai_notes && (
        <p className="text-xs italic text-[var(--muted-foreground)] break-words">{session.ai_notes}</p>
      )}
      {session.status === 'completed' && session.completed_activity_id && (
        <Link
          href={`/activities/${session.completed_activity_id}`}
          className="inline-flex min-h-11 items-center text-sm font-medium text-[var(--primary)] underline-offset-4 hover:underline"
        >
          View activity
        </Link>
      )}

      {canMove && !moving && (
        <Button
          type="button"
          variant="outline"
          className="min-h-11 w-full"
          onClick={() => {
            setDate(session.scheduled_date)
            setError(null)
            setMoving(true)
          }}
          aria-label={`Move ${typeLabel} on ${dayLabel(session.scheduled_date)} to another date`}
        >
          Move to…
        </Button>
      )}

      {canMove && moving && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <label htmlFor={inputId} className="block text-xs font-medium text-[var(--foreground)]">
            Move to date
          </label>
          <input
            id={inputId}
            type="date"
            value={date}
            min={minDate}
            max={maxDate}
            onChange={(e) => setDate(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className="h-11 w-full rounded-md border border-[var(--border)] bg-transparent px-3 text-base text-[var(--foreground)]"
          />
          {error && (
            <p id={errorId} role="alert" className="text-xs text-[var(--destructive)]">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="submit" className="min-h-11 flex-1" disabled={busy}>
              {busy ? 'Moving…' : 'Move'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="min-h-11"
              disabled={busy}
              onClick={() => setMoving(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </article>
  )
}
