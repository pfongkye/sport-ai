import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'AI Coach' }

export default function CoachPage() {
  return (
    <div className="flex flex-col h-full p-4 md:p-6 items-center justify-center text-center">
      <p className="text-4xl mb-3" aria-hidden>🤖</p>
      <h1 className="text-xl font-bold text-[var(--foreground)]">AI Coach</h1>
      <p className="text-sm text-[var(--muted-foreground)] mt-1 max-w-xs">
        Voice-first coaching chat coming in Phase 2. The agent, tools, and MCP servers are already wired up.
      </p>
    </div>
  )
}
