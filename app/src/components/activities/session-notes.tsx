'use client'

import { useEffect, useState } from 'react'
import { http } from '@/lib/http'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { VoiceRecorder } from '@/components/chat/voice-recorder'
import { timeAgo } from '@/lib/utils'

interface Note {
  id: string
  transcript: string
  source: 'voice' | 'text'
  duration_s: number | null
  created_at: string
}

/**
 * Per-session notes: record a voice note (transcribed) or type one, edit the
 * text, then Save. An activity can hold many notes. Transcript-only.
 */
export function SessionNotes({ activityId }: { activityId: string }) {
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState('')
  const [source, setSource] = useState<'voice' | 'text'>('text')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    http(`/api/activities/${activityId}/notes`)
      .then((r) => (r.ok ? r.json() : { notes: [] }))
      .then((d) => setNotes(d.notes ?? []))
      .catch(() => setNotes([]))
      .finally(() => setLoading(false))
  }, [activityId])

  async function save() {
    const transcript = draft.trim()
    if (!transcript || saving) return
    setSaving(true)
    try {
      const res = await http(`/api/activities/${activityId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript, source }),
      })
      const json = await res.json().catch(() => ({}))
      if (res.ok && json.note) {
        setNotes((prev) => [...prev, json.note])
        setDraft('')
        setSource('text')
      }
    } finally {
      setSaving(false)
    }
  }

  async function remove(noteId: string) {
    const res = await http(`/api/activities/${activityId}/notes/${noteId}`, { method: 'DELETE' })
    if (res.ok) setNotes((prev) => prev.filter((n) => n.id !== noteId))
  }

  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <h2 className="font-semibold text-[var(--foreground)] flex items-center gap-2">
          <span aria-hidden>📝</span> Session notes
        </h2>

        {/* Existing notes */}
        {loading ? (
          <p className="text-sm text-[var(--muted-foreground)]">Loading…</p>
        ) : notes.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">
            No notes yet. Add how this session felt — the coach uses it alongside the data.
          </p>
        ) : (
          <ul className="space-y-2">
            {notes.map((n) => (
              <li
                key={n.id}
                className="group flex items-start gap-2 rounded-lg border border-[var(--border)] px-3 py-2"
              >
                <span className="text-xs mt-0.5 shrink-0" aria-hidden>
                  {n.source === 'voice' ? '🎙️' : '✏️'}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-[var(--foreground)] whitespace-pre-wrap">
                    {n.transcript}
                  </p>
                  <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
                    {timeAgo(n.created_at)}
                  </p>
                </div>
                <button
                  onClick={() => remove(n.id)}
                  aria-label="Delete note"
                  className="shrink-0 text-[var(--muted-foreground)] hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-4" aria-hidden>
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Composer: voice fills the editable field; user can correct before saving */}
        <div className="flex items-end gap-2">
          <VoiceRecorder
            disabled={saving}
            onTranscript={(text) => {
              if (!text) return
              setSource('voice')
              setDraft((prev) => (prev ? `${prev} ${text}` : text))
            }}
          />
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                save()
              }
            }}
            placeholder="Type a note, or tap the mic and edit the transcript…"
            rows={2}
            className="flex-1 resize-none rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
          />
          <Button onClick={save} disabled={saving || !draft.trim()} size="sm">
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
