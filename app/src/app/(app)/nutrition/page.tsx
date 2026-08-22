import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Nutrition' }

export default function NutritionPage() {
  return (
    <div className="flex flex-col h-full p-4 md:p-6 items-center justify-center text-center">
      <p className="text-4xl mb-3" aria-hidden>🥗</p>
      <h1 className="text-xl font-bold text-[var(--foreground)]">Nutrition</h1>
      <p className="text-sm text-[var(--muted-foreground)] mt-1 max-w-xs">
        Photo logging, macro tracking, and AI advice coming in Phase 4.
      </p>
    </div>
  )
}
