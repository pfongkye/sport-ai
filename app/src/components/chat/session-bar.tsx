'use client'

import { useT } from '@/lib/i18n/client'

interface SessionBarProps {
  title: string
  open: boolean
  busy: boolean
  canCreate: boolean
  onToggle: () => void
  onNew: () => void
}

export function SessionBar({ title, open, busy, canCreate, onToggle, onNew }: SessionBarProps) {
  const t = useT()
  return (
    <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 md:px-6 py-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="chat-sessions-panel"
        onClick={onToggle}
        className="min-h-11 shrink-0 rounded-lg border border-[var(--border)] px-3 text-sm font-medium hover:bg-[var(--muted)]"
      >
        {t('coach.chats')}
      </button>
      <p className="flex-1 min-w-0 truncate text-sm text-[var(--muted-foreground)]" title={title}>
        {title}
      </p>
      <button
        type="button"
        disabled={busy || !canCreate}
        onClick={onNew}
        className="min-h-11 shrink-0 rounded-lg bg-[var(--primary)] px-3 text-sm font-medium text-white disabled:opacity-40"
      >
        {t('coach.newChat')}
      </button>
    </div>
  )
}
