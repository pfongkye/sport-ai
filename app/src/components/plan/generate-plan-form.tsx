'use client'

import { useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import { http } from '@/lib/http'
import { Button } from '@/components/ui/button'

interface Props {
  defaultGoal: string
  /** True when an active plan exists: generating replaces (archives) it. */
  replacing: boolean
  onDone?: (message: string, note?: string) => void
}

/** Goal + optional goal date → POST /api/plan/generate, then refresh the page data. */
export function GeneratePlanForm({ defaultGoal, replacing, onDone }: Props) {
  const router = useRouter()
  const goalId = useId()
  const dateId = useId()
  const errId = useId()
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
        body: JSON.stringify({ goal: goal.trim() || null, goalDate: goalDate || null }),
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
