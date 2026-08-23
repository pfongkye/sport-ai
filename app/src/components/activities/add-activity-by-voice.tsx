'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { http } from '@/lib/http'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { VoiceRecorder } from '@/components/chat/voice-recorder'
import { SPORT_LABELS } from '@/lib/utils'
import type { ActivityDraft, StrengthBlock } from '@/types/activity'

type Phase = 'input' | 'draft'

const SPORTS = ['run', 'football', 'gym', 'cycle', 'other'] as const

/** Editable form state — numbers are held as strings for friendly inputs. */
interface DraftForm {
  sportType: string
  date: string // yyyy-mm-dd
  time: string // hh:mm
  durationMin: string
  distanceKm: string
  avgHrBpm: string
  paceMinPerKm: string // mm:ss
  rpe: string
  notes: string
  strength: StrengthBlock[]
}

const EXAMPLES = [
  'My last run was 10km at 5\'14/km with hr 139',
  'Gym session with 2x8 squat and 3x5 deadlift 80kg',
  'Football yesterday, 90 minutes, felt like an RPE 7',
]

export function AddActivityByVoice({ onDone }: { onDone?: () => void }) {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>('input')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState<DraftForm | null>(null)
  const [needsTime, setNeedsTime] = useState(false)
  const [assumptions, setAssumptions] = useState<string[]>([])
  const [transcript, setTranscript] = useState('')
  const [duplicate, setDuplicate] = useState<{ id: string; started_at: string } | null>(null)

  async function parse() {
    const value = text.trim()
    if (!value || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await http('/api/activities/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: value,
          clientNow: new Date().toISOString(),
          tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error ?? `Parse failed (HTTP ${res.status})`)
        return
      }
      const draft = json.draft as ActivityDraft
      setForm(draftToForm(draft))
      setNeedsTime(draft.dateTimeNeedsConfirmation || !draft.startedAt)
      setAssumptions(draft.assumptions ?? [])
      setTranscript(draft.transcript ?? value)
      setDuplicate(null)
      setPhase('draft')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setBusy(false)
    }
  }

  async function save(force = false) {
    if (!form || busy) return
    const startedAt = combineDateTime(form.date, form.time)
    if (!form.sportType || !startedAt) {
      setError('Sport and date/time are required.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await http('/api/activities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formToDraft(form, startedAt, transcript), force }),
      })
      const json = await res.json().catch(() => ({}))

      if (res.status === 409) {
        setDuplicate(json.duplicate ?? null)
        return
      }
      if (!res.ok) {
        setError(json.message ?? json.error ?? `Save failed (HTTP ${res.status})`)
        return
      }
      router.refresh()
      onDone?.()
      if (json.id) router.push(`/activities/${json.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setBusy(false)
    }
  }

  function reset() {
    setPhase('input')
    setForm(null)
    setError(null)
    setDuplicate(null)
    setText('')
  }

  // ── Input phase ────────────────────────────────────────────────────────────
  if (phase === 'input') {
    return (
      <div className="space-y-3">
        <Label htmlFor="activity-text">Describe your activity</Label>
        <div className="flex items-start gap-2">
          <textarea
            id="activity-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder="e.g. 10k run this morning at 5:14/km, hr 139"
            className="flex-1 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          />
          <VoiceRecorder
            disabled={busy}
            onTranscript={(t) => {
              if (t) setText((prev) => (prev ? `${prev} ${t}` : t))
            }}
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => setText(ex)}
              className="rounded-full border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
            >
              {ex}
            </button>
          ))}
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
        <Button className="w-full" onClick={parse} disabled={busy || !text.trim()}>
          {busy ? 'Parsing…' : 'Parse activity'}
        </Button>
      </div>
    )
  }

  // ── Draft phase ──────────────────────────────────────────────────────────
  if (!form) return null
  const saveDisabled = busy || !form.sportType || !form.date || !form.time

  return (
    <div className="space-y-4">
      {assumptions.length > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
          <p className="font-medium">Please double-check:</p>
          <ul className="mt-1 list-disc pl-4 space-y-0.5">
            {assumptions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Sport">
          <select
            value={form.sportType}
            onChange={(e) => setForm({ ...form, sportType: e.target.value })}
            className="flex h-10 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          >
            <option value="">Select…</option>
            {SPORTS.map((s) => (
              <option key={s} value={s}>
                {SPORT_LABELS[s] ?? s}
              </option>
            ))}
          </select>
        </Field>
        <Field label="RPE (1–10)">
          <Input
            type="number"
            min={1}
            max={10}
            value={form.rpe}
            onChange={(e) => setForm({ ...form, rpe: e.target.value })}
          />
        </Field>

        <Field label="Date" highlight={needsTime}>
          <Input
            type="date"
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
          />
        </Field>
        <Field label="Time" highlight={needsTime}>
          <Input
            type="time"
            value={form.time}
            onChange={(e) => setForm({ ...form, time: e.target.value })}
          />
        </Field>

        <Field label="Duration (min)">
          <Input
            type="number"
            min={0}
            value={form.durationMin}
            onChange={(e) => setForm({ ...form, durationMin: e.target.value })}
          />
        </Field>
        <Field label="Distance (km)">
          <Input
            type="number"
            min={0}
            step="0.01"
            value={form.distanceKm}
            onChange={(e) => setForm({ ...form, distanceKm: e.target.value })}
          />
        </Field>

        <Field label="Avg HR (bpm)">
          <Input
            type="number"
            min={0}
            value={form.avgHrBpm}
            onChange={(e) => setForm({ ...form, avgHrBpm: e.target.value })}
          />
        </Field>
        <Field label="Pace (mm:ss/km)">
          <Input
            type="text"
            placeholder="5:14"
            value={form.paceMinPerKm}
            onChange={(e) => setForm({ ...form, paceMinPerKm: e.target.value })}
          />
        </Field>
      </div>

      <Field label="Notes">
        <textarea
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          rows={2}
          className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        />
      </Field>

      {form.strength.length > 0 && (
        <div className="rounded-md border border-[var(--border)] px-3 py-2 text-xs">
          <p className="font-medium mb-1">Strength</p>
          <ul className="space-y-0.5 text-[var(--muted-foreground)]">
            {form.strength.map((b, i) => (
              <li key={i}>
                {b.exercise}
                {b.sets != null && b.reps != null ? ` — ${b.sets}×${b.reps}` : ''}
                {b.weightKg != null ? ` @${b.weightKg}kg` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}

      {needsTime && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Confirm the exact date and time before saving.
        </p>
      )}

      {duplicate && (
        <div className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs">
          <p className="text-amber-700 dark:text-amber-300">
            A similar activity already exists near that time.{' '}
            <a href={`/activities/${duplicate.id}`} className="underline">
              View it
            </a>
            .
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => save(true)}
            disabled={busy}
          >
            Save anyway
          </Button>
        </div>
      )}

      {error && <p className="text-xs text-red-500">{error}</p>}

      <div className="flex gap-2">
        <Button className="flex-1" onClick={() => save(false)} disabled={saveDisabled}>
          {busy ? 'Saving…' : 'Save activity'}
        </Button>
        <Button variant="outline" onClick={() => setPhase('input')} disabled={busy}>
          Edit text
        </Button>
        <Button variant="ghost" onClick={reset} disabled={busy}>
          Discard
        </Button>
      </div>
    </div>
  )
}

function Field({
  label,
  highlight,
  children,
}: {
  label: string
  highlight?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1">
      <Label className={highlight ? 'text-amber-600 dark:text-amber-400' : undefined}>
        {label}
      </Label>
      {children}
    </div>
  )
}

// ── Conversions between the stored draft and the editable form ───────────────

function draftToForm(d: ActivityDraft): DraftForm {
  const dt = d.startedAt ? new Date(d.startedAt) : null
  return {
    sportType: d.sportType ?? '',
    date: dt ? toDateInput(dt) : '',
    time: dt ? toTimeInput(dt) : '',
    durationMin: d.durationS != null ? String(Math.round(d.durationS / 60)) : '',
    distanceKm: d.distanceM != null ? String(+(d.distanceM / 1000).toFixed(2)) : '',
    avgHrBpm: d.avgHrBpm != null ? String(d.avgHrBpm) : '',
    paceMinPerKm: d.avgPaceSPerKm != null ? secToMMSS(d.avgPaceSPerKm) : '',
    rpe: d.rpe != null ? String(d.rpe) : '',
    notes: d.notes ?? '',
    strength: d.strength ?? [],
  }
}

function formToDraft(f: DraftForm, startedAt: string, transcript: string) {
  const durationMin = numOrNull(f.durationMin)
  const distanceKm = numOrNull(f.distanceKm)
  const paceSec = mmssToSec(f.paceMinPerKm)
  const rpe = numOrNull(f.rpe)
  const hr = numOrNull(f.avgHrBpm)
  return {
    sportType: f.sportType,
    startedAt,
    dateTimeNeedsConfirmation: false,
    durationS: durationMin != null ? Math.round(durationMin * 60) : null,
    distanceM: distanceKm != null ? Math.round(distanceKm * 1000) : null,
    avgHrBpm: hr != null ? Math.round(hr) : null,
    maxHrBpm: null,
    avgPaceSPerKm: paceSec,
    avgCadenceRpm: null,
    caloriesKcal: null,
    rpe: rpe,
    notes: f.notes.trim() || null,
    strength: f.strength,
    assumptions: [],
    confidence: 'high' as const,
    transcript,
  }
}

function numOrNull(s: string): number | null {
  const t = s.trim()
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

function secToMMSS(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function mmssToSec(v: string): number | null {
  const t = v.trim()
  if (!t) return null
  const m = t.match(/^(\d+):(\d{1,2})$/)
  if (m) return Number(m[1]) * 60 + Number(m[2])
  const n = Number(t)
  return Number.isFinite(n) ? Math.round(n) : null
}

function toDateInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function toTimeInput(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** Combine the date + time inputs (local wall-clock) into an ISO string. */
function combineDateTime(date: string, time: string): string | null {
  if (!date || !time) return null
  const dt = new Date(`${date}T${time}`)
  if (Number.isNaN(dt.getTime())) return null
  return dt.toISOString()
}
