'use client'

import { useId, useState } from 'react'
import { cn } from '@/lib/utils'
import type { TrainingRecap } from '@/lib/ai/workflows/training-recap'
import { buildRecapView } from './recap-format'

/**
 * "What your plan is based on". Single column; on phones the body is collapsed
 * behind a 44px toggle, from `md` it is always open. No hover-only controls.
 */
export function PlanRecap({ recap }: { recap: TrainingRecap | null }) {
  const [open, setOpen] = useState(false)
  const bodyId = useId()

  if (!recap) {
    return (
      <section aria-label="What your plan is based on" className="rounded-lg border border-[var(--border)] p-3">
        <h3 className="text-sm font-semibold text-[var(--foreground)]">What your plan is based on</h3>
        <p className="text-xs text-[var(--muted-foreground)] mt-1">
          Not available for this plan. Plans created before recaps were stored have no snapshot; regenerate to get one.
        </p>
      </section>
    )
  }
  const view = buildRecapView(recap)
  return (
    <section aria-label="What your plan is based on" className="rounded-lg border border-[var(--border)] p-3">
      <button
        type="button"
        className="flex min-h-11 w-full items-center justify-between gap-2 text-left md:pointer-events-none"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-[var(--foreground)]">What your plan is based on</span>
          <span className="block text-xs text-[var(--muted-foreground)]">{view.summary}</span>
        </span>
        <span aria-hidden className="md:hidden text-[var(--muted-foreground)]">
          {open ? '−' : '+'}
        </span>
      </button>
      <div id={bodyId} className={cn('space-y-3 pt-2', open ? 'block' : 'hidden', 'md:block')}>
        <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2 short-landscape:grid-cols-2">
          {view.facts.map((f) => (
            <div key={f.label} className="min-w-0">
              <dt className="text-xs text-[var(--muted-foreground)]">{f.label}</dt>
              <dd className="text-sm text-[var(--foreground)] break-words">{f.value}</dd>
            </div>
          ))}
        </dl>
        <div>
          <h4 className="text-xs font-semibold text-[var(--muted-foreground)] mb-1">Weeks analysed</h4>
          <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2 short-landscape:grid-cols-2">
            {view.weeks.map((w) => (
              <li
                key={w.key}
                className={cn('text-xs', w.used ? 'text-[var(--foreground)]' : 'text-[var(--muted-foreground)]')}
              >
                <span className="font-medium">{w.label}</span>: {w.detail}
              </li>
            ))}
          </ul>
        </div>
        {view.notes.length > 0 && (
          <ul className="list-disc pl-4 text-xs text-[var(--muted-foreground)] space-y-0.5">
            {view.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
