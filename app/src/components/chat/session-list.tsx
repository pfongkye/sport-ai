'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useLocale, useT } from '@/lib/i18n/client'
import { intlLocale, type Locale } from '@/lib/i18n/locales'

export interface ChatSession {
  id: string
  title: string
  created_at: string
  updated_at: string
}

interface SessionListProps {
  sessions: ChatSession[]
  activeId: string | null
  /** True while a reply is streaming: switching and deleting are blocked. */
  busy: boolean
  onSelect: (id: string) => void
  /** Resolves to an error message, or null on success. */
  onDelete: (id: string, keepSummary: boolean) => Promise<string | null>
}

function dateLabel(iso: string, locale: Locale) {
  return new Date(iso).toLocaleDateString(intlLocale(locale), { month: 'short', day: 'numeric' })
}

export function SessionList({ sessions, activeId, busy, onSelect, onDelete }: SessionListProps) {
  const t = useT()
  const locale = useLocale()
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [pending, setPending] = useState<'keep' | 'all' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run(id: string, keep: boolean) {
    setPending(keep ? 'keep' : 'all')
    setError(null)
    const err = await onDelete(id, keep)
    setPending(null)
    if (err) setError(err)
    else setConfirmingId(null)
  }

  if (sessions.length === 0) {
    return <p className="text-sm text-[var(--muted-foreground)]">{t('coach.noChats')}</p>
  }

  return (
    <ul className="space-y-1">
      {sessions.map((s) => {
        const active = s.id === activeId
        const confirming = confirmingId === s.id
        return (
          <li key={s.id} className="rounded-lg border border-[var(--border)]">
            <div className="flex items-stretch">
              <button
                type="button"
                disabled={busy}
                aria-current={active ? 'true' : undefined}
                onClick={() => onSelect(s.id)}
                className={cn(
                  'flex-1 min-w-0 min-h-11 px-3 py-2 text-left rounded-l-lg transition-colors disabled:opacity-50',
                  active ? 'bg-[var(--primary)]/15' : 'hover:bg-[var(--muted)]'
                )}
              >
                <span className="block truncate text-sm font-medium text-[var(--foreground)]">{s.title}</span>
                <span className="block text-xs text-[var(--muted-foreground)]">{dateLabel(s.updated_at, locale)}</span>
              </button>
              <button
                type="button"
                disabled={busy}
                aria-label={t('coach.deleteChatAria', { title: s.title })}
                aria-expanded={confirming}
                onClick={() => {
                  setError(null)
                  setConfirmingId(confirming ? null : s.id)
                }}
                className="shrink-0 flex items-center justify-center size-11 rounded-r-lg text-[var(--destructive)] hover:bg-[var(--muted)] disabled:opacity-50"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-5" aria-hidden>
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V4h6v2" />
                </svg>
              </button>
            </div>

            {confirming && (
              <div
                role="alertdialog"
                aria-label={t('coach.confirmDeleteAria', { title: s.title })}
                className="m-2 space-y-2 rounded-md border border-[var(--destructive)] p-2"
              >
                <p className="text-xs text-[var(--foreground)]">
                  {t('coach.deleteExplain')}
                </p>
                {error && (
                  <p role="alert" className="text-xs text-[var(--destructive)]">
                    {error}
                  </p>
                )}
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                  <Button
                    type="button"
                    className="min-h-11 whitespace-normal"
                    disabled={pending !== null}
                    onClick={() => void run(s.id, true)}
                  >
                    {pending === 'keep' ? t('coach.summarizingShort') : t('coach.deleteKeep')}
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    className="min-h-11 whitespace-normal"
                    disabled={pending !== null}
                    onClick={() => void run(s.id, false)}
                  >
                    {pending === 'all' ? t('coach.deletingShort') : t('coach.deleteAll')}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="min-h-11"
                    disabled={pending !== null}
                    autoFocus
                    onClick={() => setConfirmingId(null)}
                  >
                    {t('common.cancel')}
                  </Button>
                </div>
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
