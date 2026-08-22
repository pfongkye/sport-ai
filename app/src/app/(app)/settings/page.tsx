import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Settings' }

export default function SettingsPage() {
  return (
    <div className="flex flex-col h-full p-4 md:p-6 items-center justify-center text-center">
      <p className="text-4xl mb-3" aria-hidden>⚙️</p>
      <h1 className="text-xl font-bold text-[var(--foreground)]">Settings</h1>
      <p className="text-sm text-[var(--muted-foreground)] mt-1 max-w-xs">
        AI provider configuration and preferences coming in Phase 2 task 2.8.
      </p>
    </div>
  )
}
