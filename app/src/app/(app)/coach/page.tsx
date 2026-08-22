import type { Metadata } from 'next'
import { ChatInterface } from '@/components/chat/chat-interface'

export const metadata: Metadata = { title: 'AI Coach' }

export default function CoachPage() {
  return (
    <div className="flex flex-col h-[calc(100vh-0px)] md:h-screen">
      <header className="border-b border-[var(--border)] px-4 md:px-6 py-3 shrink-0">
        <h1 className="text-lg font-bold text-[var(--foreground)]">AI Coach</h1>
      </header>
      <div className="flex-1 min-h-0">
        <ChatInterface />
      </div>
    </div>
  )
}
