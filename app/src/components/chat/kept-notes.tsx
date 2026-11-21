'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { http } from '@/lib/http'

export interface CoachMemory {
  id: string
  title: string
  summary: string
  created_at: string
}

interface KeptNotesProps {
  memories: CoachMemory[]
  onChange: (next: CoachMemory[], message: string) => void
}

export function KeptNotes({ memories, onChange }: KeptNotesProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(m: CoachMemory) {
    setBusy(true)
    setError(null)
    try {
      const res = await http(`/api/ai/chat/memories/${m.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary: draft }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? 'Could not save the note.')
        return
      }
      onChange(memories.map((x) => (x.id === m.id ? { ...x, ...data.memory } : x)), 'Note saved.')
      setEditingId(null)
    } catch {
      setError('Could not save the note.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(m: CoachMemory) {
    setBusy(true)
    setError(null)
    try {
      const res = await http(`/api/ai/chat/memories/${m.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Could not delete the note.')
        return
      }
      onChange(memories.filter((x) => x.id !== m.id), 'Note deleted.')
      setConfirmingId(null)
    } catch {
      setError('Could not delete the note.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-label="Kept notes" className="space-y-2">
      <h2 className="text-sm font-semibold text-[var(--foreground)]">Kept notes</h2>
      <p className="text-xs text-[var(--muted-foreground)]">
        The coach reads these notes in new chats. Edit or delete any note you no longer want it to use.
      </p>
      {memories.length === 0 && (
        <p className="text-sm text-[var(--muted-foreground)]">No kept notes yet.</p>
      )}
      <ul className="space-y-2">
        {memories.map((m) => (
          <li key={m.id} className="rounded-lg border border-[var(--border)] p-3 space-y-2">
            <p className="text-sm font-medium text-[var(--foreground)] break-words">{m.title}</p>
            {editingId === m.id ? (
              <>
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  aria-label={`Edit note ${m.title}`}
                  rows={5}
                  maxLength={2000}
                  className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                />
                {error && (
                  <p role="alert" className="text-xs text-[var(--destructive)]">
                    {error}
                  </p>
                )}
                <div className="flex gap-2">
                  <Button type="button" className="min-h-11" disabled={busy || !draft.trim()} onClick={() => void save(m)}>
                    Save
                  </Button>
                  <Button type="button" variant="ghost" className="min-h-11" disabled={busy} onClick={() => setEditingId(null)}>
                    Cancel
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-[var(--muted-foreground)] whitespace-pre-wrap break-words">{m.summary}</p>
                {confirmingId === m.id ? (
                  <div
                    role="alertdialog"
                    aria-label={`Confirm deleting note ${m.title}`}
                    className="space-y-2 rounded-md border border-[var(--destructive)] p-2"
                  >
                    <p className="text-xs text-[var(--foreground)]">Delete this note? The coach will forget it.</p>
                    {error && (
                      <p role="alert" className="text-xs text-[var(--destructive)]">
                        {error}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="destructive" className="min-h-11" disabled={busy} onClick={() => void remove(m)}>
                        Delete note
                      </Button>
                      <Button type="button" variant="ghost" className="min-h-11" disabled={busy} autoFocus onClick={() => setConfirmingId(null)}>
                        Keep
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-11"
                      aria-label={`Edit note ${m.title}`}
                      onClick={() => {
                        setError(null)
                        setDraft(m.summary)
                        setEditingId(m.id)
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="min-h-11 text-[var(--destructive)]"
                      aria-label={`Delete note ${m.title}`}
                      onClick={() => {
                        setError(null)
                        setConfirmingId(m.id)
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
