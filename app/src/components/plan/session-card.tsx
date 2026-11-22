'use client'

import { useId, useState } from 'react'
import Link from 'next/link'
import { http } from '@/lib/http'
import { isEditableUpcoming } from '@/lib/plan/session-guard'
import { isDeletable } from '@/lib/plan/delete-session'
import type { PlanSessionRow } from '@/lib/plan/load-plan'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SPORT_EMOJI } from '@/lib/utils'
import type { DictKey } from '@/lib/i18n/dictionaries/en'
import { useLocale, useT } from '@/lib/i18n/client'
import { sessionTypeLabel, sportLabel } from '@/lib/i18n/labels'
import { dayLabel, targetSummary } from './plan-format'

const STATUS_KEY: Record<PlanSessionRow['status'], DictKey> = {
  pending: 'plan.status.pending',
  completed: 'plan.status.completed',
  skipped: 'plan.status.skipped',
  modified: 'plan.status.modified',
}

const STATUS_VARIANT: Record<PlanSessionRow['status'], 'secondary' | 'success' | 'warning' | 'info'> = {
  pending: 'secondary',
  completed: 'success',
  skipped: 'warning',
  modified: 'info',
}

interface Props {
  session: PlanSessionRow
  today: string
  /** Earliest / latest date a session may be moved to (plan window, clamped to today). */
  minDate: string
  maxDate: string
  /** Called after a successful move with a screen-reader message. */
  onMoved: (message: string) => void
  /** Called after a successful delete with a screen-reader message. */
  onDeleted: (message: string) => void
}

/**
 * One planned session. Future, editable sessions (pending or moved) get a visible "Move" button
 * (44px target, never hover-only: gotcha #23) that opens an inline date picker.
 * Past/completed/skipped sessions show no control. The server re-checks
 * the guard on PATCH (Req 2a.4); this check only decides whether to show the UI.
 */
export function SessionCard({ session, today, minDate, maxDate, onMoved, onDeleted }: Props) {
  const t = useT()
  const locale = useLocale()
  const inputId = useId()
  const errorId = useId()
  const [moving, setMoving] = useState(false)
  const [date, setDate] = useState(session.scheduled_date)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canMove = isEditableUpcoming(session, today)
  const canDelete = isDeletable(session)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const deleteErrId = useId()
  const badge = { label: t(STATUS_KEY[session.status]), variant: STATUS_VARIANT[session.status] }
  const typeLabel = session.session_type
    ? sessionTypeLabel(t, session.session_type)
    : sportLabel(t, session.sport_type)
  const targets = targetSummary(session, locale)

  async function submit() {
    if (!date || date === session.scheduled_date) {
      setError(t('plan.pickDifferentDate'))
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
        setError(json.error ?? t('plan.moveFailed'))
        return
      }
      setMoving(false)
      onMoved(t('plan.moved', { type: typeLabel, day: dayLabel(date, locale) }))
    } catch {
      setError(t('common.networkError'))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setDeleting(true)
    setDeleteError(null)
    try {
      const res = await http(`/api/plan/sessions/${session.id}`, { method: 'DELETE' })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setDeleteError(json.error ?? t('plan.deleteFailed'))
        return
      }
      onDeleted(t('plan.deleted', { type: typeLabel, day: dayLabel(session.scheduled_date, locale) }))
    } catch {
      setDeleteError(t('common.networkError'))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <article
      className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3 space-y-2"
      aria-label={t('plan.sessionAria', { type: typeLabel, day: dayLabel(session.scheduled_date, locale), status: badge.label })}
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
          {t('plan.viewActivity')}
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
          aria-label={t('plan.moveAria', { type: typeLabel, day: dayLabel(session.scheduled_date, locale) })}
        >
          {t('plan.moveTo')}
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
            {t('plan.moveToDate')}
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
              {busy ? t('plan.moving') : t('plan.move')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="min-h-11"
              disabled={busy}
              onClick={() => setMoving(false)}
            >
              {t('plan.cancel')}
            </Button>
          </div>
        </form>
      )}

      {canDelete && !moving && !confirmingDelete && (
        <Button
          type="button"
          variant="ghost"
          className="min-h-11 w-full text-[var(--destructive)]"
          onClick={() => {
            setDeleteError(null)
            setConfirmingDelete(true)
          }}
          aria-label={t('plan.deleteAria', { type: typeLabel, day: dayLabel(session.scheduled_date, locale) })}
        >
          {t('plan.delete')}
        </Button>
      )}

      {canDelete && confirmingDelete && (
        <div
          role="alertdialog"
          aria-label={t('plan.confirmDeleteAria', { type: typeLabel })}
          className="space-y-2 rounded-md border border-[var(--destructive)] p-2"
        >
          <p className="text-xs text-[var(--foreground)]">
            {t('plan.deleteExplain')}
          </p>
          {deleteError && (
            <p id={deleteErrId} role="alert" className="text-xs text-[var(--destructive)]">
              {deleteError}
            </p>
          )}
          <div className="flex flex-col gap-2">
            <Button
              type="button"
              variant="destructive"
              className="min-h-11 w-full whitespace-normal"
              disabled={deleting}
              onClick={() => void remove()}
            >
              {deleting ? t('plan.deleting') : t('plan.deleteSession')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="min-h-11 w-full"
              disabled={deleting}
              autoFocus
              onClick={() => setConfirmingDelete(false)}
            >
              {t('plan.keep')}
            </Button>
          </div>
        </div>
      )}
    </article>
  )
}
