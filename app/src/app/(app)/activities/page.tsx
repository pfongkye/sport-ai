import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Activities' }

export default function ActivitiesPage() {
  return (
    <div className="flex flex-col h-full p-4 md:p-6 items-center justify-center text-center">
      <p className="text-4xl mb-3" aria-hidden>🏃</p>
      <h1 className="text-xl font-bold text-[var(--foreground)]">Activities</h1>
      <p className="text-sm text-[var(--muted-foreground)] mt-1 max-w-xs">
        Activity list, .FIT/.GPX/.TCX upload, and detail view coming in Phase 1 tasks 1.4–1.6.
      </p>
    </div>
  )
}
