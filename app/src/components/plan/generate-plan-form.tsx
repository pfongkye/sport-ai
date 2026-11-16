'use client'

import { useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import { http } from '@/lib/http'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { WEEKDAY_NAMES } from '@/lib/plan/dates'
import { MAX_NOTES_LENGTH, NO_CONSTRAINTS, type PlanConstraints } from '@/lib/plan/constraints'

interface Props {
  defaultGoal: string
  /** True when an active plan exists: generating replaces (archives) it. */
  replacing: boolean
  /** Constraints of the plan being replaced, to pre-fill the form on regeneration. */
  defaultConstraints?: PlanConstraints
  onDone?: (message: string, note?: string) => void
}

/** Goal + optional goal date → POST /api/plan/generate, then refresh the page data. */
export function GeneratePlanForm({ defaultGoal, replacing, defaultConstraints = NO_CONSTRAINTS, onDone }: Props) {
  const router = useRouter()
  const goalId = useId()
  const dateId = useId()
  const errId = useId()
  const notesId = useId()
  const notesHelpId = useId()
  const [unavailable, setUnavailable] = useState<string[]>(defaultConstraints.unavailableWeekdays)
  const [notes, setNotes] = useState(defaultConstraints.notes ?? '')
  const [goal, setGoal] = useState(defaultGoal)
  const [goalDate, setGoalDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (replacing && !window.confirm('This replaces your current plan (it is archived). Continue?')) return
    setBusy(true)
    setError(null)
    try {
      const res = await http('/api/plan/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          goal: goal.trim() || null,
          goalDate: goalDate || null,
          constraints: { unavailableWeekdays: WEEKDAY_NAMES.filter((d) => unavailable.includes(d)), notes: notes.trim() || null },
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        error?: string
        sessionCount?: number
        weeks?: number
        adjustments?: string[]
      }
      if (!res.ok) {
        setError(json.error ?? 'Could not generate a plan.')
        return
      }
      const n = json.adjustments?.length ?? 0
      onDone?.(
        `Plan created: ${json.sessionCount ?? 0} sessions over ${json.weeks ?? 0} weeks.`,
        n ? `Adjusted ${n} ${n === 1 ? 'week' : 'weeks'} to keep weekly increases under 10%.` : undefined
      )
      router.refresh()
    } catch {
      setError('Network error. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="space-y-3 max-w-md w-full text-left"
      aria-busy={busy}
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <div className="space-y-1">
        <label htmlFor={goalId} className="block text-sm font-medium text-[var(--foreground)]">
          Goal
        </label>
        <input
          id={goalId}
          type="text"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="e.g. Marathon in 3h30"
          maxLength={300}
          disabled={busy}
          className="h-11 w-full rounded-md border border-[var(--border)] bg-transparent px-3 text-base text-[var(--foreground)]"
        />
      </div>
      <div className="space-y-1">
        <label htmlFor={dateId} className="block text-sm font-medium text-[var(--foreground)]">
          Goal date (optional)
        </label>
        <input
          id={dateId}
          type="date"
          value={goalDate}
          onChange={(e) => setGoalDate(e.target.value)}
          disabled={busy}
          className="h-11 w-full rounded-md border border-[var(--border)] bg-transparent px-3 text-base text-[var(--foreground)]"
        />
        <p className="text-xs text-[var(--muted-foreground)]">
          With a date the plan builds to it and tapers. Without one you get a general 12-week block.
        </p>
      </div>
      <fieldset className="space-y-1" disabled={busy}>
        <legend className="block text-sm font-medium text-[var(--foreground)]">
          Days you cannot train (optional)
        </legend>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
          {WEEKDAY_NAMES.map((day) => {
            const checked = unavailable.includes(day)
            return (
              <label
                key={day}
                className={cn(
                  'flex min-h-11 cursor-pointer items-center justify-center rounded-md border px-2 text-sm capitalize',
                  checked
                    ? 'border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]'
                    : 'border-[var(--border)] text-[var(--foreground)]',
                  'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--ring)]'
                )}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={checked}
                  onChange={() =>
                    setUnavailable((cur) =>
                      cur.includes(day) ? cur.filter((d) => d !== day) : [...cur, day]
                    )
                  }
                  aria-label={day}
                />
                <span aria-hidden>{day.slice(0, 3)}</span>
              </label>
            )
          })}
        </div>
        <p className="text-xs text-[var(--muted-foreground)]">No sessions are scheduled on the selected days.</p>
      </fieldset>
      <div className="space-y-1">
        <label htmlFor={notesId} className="block text-sm font-medium text-[var(--foreground)]">
          Other constraints (optional)
        </label>
        <textarea
          id={notesId}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. 1 leisure session per week, no hard runs in May, travelling 12 to 16 June"
          maxLength={MAX_NOTES_LENGTH}
          rows={3}
          disabled={busy}
          aria-describedby={notesHelpId}
          className="w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-base text-[var(--foreground)]"
        />
        <p id={notesHelpId} className="text-xs text-[var(--muted-foreground)]">
          The coach follows these as closely as it can. Selected days above are strictly enforced; free text is best effort.{' '}
          {notes.length}/{MAX_NOTES_LENGTH}
        </p>
      </div>
      {error && (
        <p id={errId} role="alert" className="text-sm text-[var(--destructive)]">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full min-h-12" disabled={busy}>
        {busy ? 'Building your plan…' : replacing ? 'Regenerate plan' : 'Generate plan'}
      </Button>
      {busy && (
        <p role="status" className="text-xs text-[var(--muted-foreground)]">
          This can take up to a minute. Keep this page open.
        </p>
      )}
    </form>
  )
}
