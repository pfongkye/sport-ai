import type { Metadata } from 'next'
import { ChatInterface } from '@/components/chat/chat-interface'
import { getT } from '@/lib/i18n/server'

export const metadata: Metadata = { title: 'AI Coach' }

export default async function CoachPage() {
  const { t } = await getT()
  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem-env(safe-area-inset-top))] md:h-screen">
      <header className="border-b border-[var(--border)] px-4 md:px-6 py-3 shrink-0">
        <h1 className="text-lg font-bold text-[var(--foreground)]">{t('coach.title')}</h1>
      </header>
      <div className="flex-1 min-h-0">
        <ChatInterface />
      </div>
    </div>
  )
}
