'use client'

import { useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import { http } from '@/lib/http'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { WEEKDAY_NAMES } from '@/lib/plan/dates'
import { MAX_NOTES_LENGTH, NO_CONSTRAINTS, type PlanConstraints } from '@/lib/plan/constraints'
import {
  OTHER_DISTANCE_MAX_KM,
  OTHER_DISTANCE_MIN_KM,
  STANDARD_DISTANCE_KM,
  formatRaceKm,
  resolveLimits,
  type LimitOverrides,
  type RaceDistance,
  type RaceGoal,
} from '@/lib/plan/race-goal'

const DISTANCE_OPTIONS: { value: RaceDistance | ''; label: string }[] = [
  { value: '', label: 'No race (general plan)' },
  { value: '5k', label: '5 km' },
  { value: '10k', label: '10 km' },
  { value: 'half', label: 'Half marathon' },
  { value: 'marathon', label: 'Marathon' },
  { value: 'other', label: 'Other distance' },
]

const DISTANCE_LABEL: Record<RaceDistance, string> = {
  '5k': '5 km',
  '10k': '10 km',
  half: 'a half marathon',
  marathon: 'a marathon',
  other: 'this distance',
}

const numStr = (n: number | null | undefined) => (n == null ? '' : String(n))
const inputCls =
  'h-11 w-full rounded-md border border-[var(--border)] bg-transparent px-3 text-base text-[var(--foreground)]'

/** Whole number from a text field; '' is 0, anything else invalid is NaN. */
function wholeOrZero(v: string): number {
  return v.trim() === '' ? 0 : Number(v)
}

interface Props {
  defaultGoal: string
  /** True when an active plan exists: generating replaces (archives) it. */
  replacing: boolean
  /** Constraints of the plan being replaced, to pre-fill the form on regeneration. */
  defaultConstraints?: PlanConstraints
  /** Pre-filled race date (YYYY-MM-DD), e.g. the end date of the plan being replaced. */
  defaultGoalDate?: string
  onDone?: (message: string, note?: string) => void
}

/** Goal + optional goal date → POST /api/plan/generate, then refresh the page data. */
export function GeneratePlanForm({ defaultGoal, replacing, defaultConstraints = NO_CONSTRAINTS, defaultGoalDate = '', onDone }: Props) {
  const router = useRouter()
  const goalId = useId()
  const dateId = useId()
  const errId = useId()
  const notesId = useId()
  const notesHelpId = useId()
  const [unavailable, setUnavailable] = useState<string[]>(defaultConstraints.unavailableWeekdays)
  const [notes, setNotes] = useState(defaultConstraints.notes ?? '')
  const [goal, setGoal] = useState(defaultGoal)
  const [goalDate, setGoalDate] = useState(defaultConstraints.race ? defaultGoalDate : '')
  const raceIdPrefix = useId()
  const [distance, setDistance] = useState<RaceDistance | ''>(defaultConstraints.race?.distance ?? '')
  const [otherKm, setOtherKm] = useState(
    defaultConstraints.race?.distance === 'other' ? String(defaultConstraints.race.distanceKm) : ''
  )
  const t0 = defaultConstraints.race?.targetTimeS ?? null
  const [hours, setHours] = useState(t0 ? String(Math.floor(t0 / 3600)) : '')
  const [minutes, setMinutes] = useState(t0 ? String(Math.floor((t0 % 3600) / 60)) : '')
  const [seconds, setSeconds] = useState(t0 ? String(t0 % 60) : '')
  const lim0 = defaultConstraints.limits
  const [maxWeekly, setMaxWeekly] = useState(numStr(lim0?.maxWeeklyKm))
  const [maxLong, setMaxLong] = useState(numStr(lim0?.maxLongRunKm))
  const [taper, setTaper] = useState(numStr(lim0?.taperDays))
  const [limitsOpen, setLimitsOpen] = useState(lim0 != null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const otherKmNum = otherKm.trim() === '' ? NaN : Number(otherKm)
  const raceKm: number | null =
    distance === '' ? null : distance === 'other' ? (Number.isFinite(otherKmNum) ? otherKmNum : null) : STANDARD_DISTANCE_KM[distance]
  const targetTimeS = wholeOrZero(hours) * 3600 + wholeOrZero(minutes) * 60 + wholeOrZero(seconds)
  const timeInvalid = [hours, minutes, seconds].some((v) => v.trim() !== '' && !Number.isInteger(Number(v)))
  // The suggestions come from the same table the server uses.
  const suggestionRace: RaceGoal | null =
    distance !== '' && raceKm != null ? { distance, distanceKm: raceKm, targetTimeS: null } : null
  const suggested = resolveLimits(suggestionRace, null)
  const distanceName =
    distance === '' ? 'a general plan' : distance === 'other' ? (raceKm != null ? `${formatRaceKm(raceKm)} km` : 'this distance') : DISTANCE_LABEL[distance]
  const suggestionText = `Suggested for ${distanceName}: ${suggested.defaults.maxWeeklyKm} km/week, ${suggested.defaults.maxLongRunKm} km long run${
    distance === '' ? '' : `, ${suggested.defaults.taperDays} day taper`
  }`
  const hasOverrides = maxWeekly.trim() !== '' || maxLong.trim() !== '' || taper.trim() !== ''

  function resetLimits() {
    setMaxWeekly('')
    setMaxLong('')
    setTaper('')
  }

  async function submit() {
    if (timeInvalid) {
      setError('Target time takes whole numbers only.')
      return
    }
    if (replacing && !window.confirm('This replaces your current plan (it is archived). Continue?')) return
    setBusy(true)
    setError(null)
    const race: Record<string, unknown> | null =
      distance === ''
        ? null
        : {
            distance,
            ...(distance === 'other' ? { distanceKm: raceKm } : {}),
            targetTimeS: targetTimeS > 0 ? targetTimeS : null,
          }
    const limitValues: LimitOverrides = {}
    if (maxWeekly.trim() !== '') limitValues.maxWeeklyKm = Number(maxWeekly)
    if (maxLong.trim() !== '') limitValues.maxLongRunKm = Number(maxLong)
    if (taper.trim() !== '') limitValues.taperDays = Number(taper)
    try {
      const res = await http('/api/plan/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          goal: goal.trim() || null,
          goalDate: goalDate || null,
          constraints: {
            unavailableWeekdays: WEEKDAY_NAMES.filter((d) => unavailable.includes(d)),
            notes: notes.trim() || null,
            race,
            limits: Object.keys(limitValues).length ? limitValues : null,
          },
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        error?: string
        sessionCount?: number
        weeks?: number
        adjustments?: string[]
      }
      if (!res.ok) {
        setError(json.error ?? 'Could not generate a plan.')
        return
      }
      const n = json.adjustments?.length ?? 0
      onDone?.(
        `Plan created: ${json.sessionCount ?? 0} sessions over ${json.weeks ?? 0} weeks.`,
        n ? `Adjusted ${n} ${n === 1 ? 'week' : 'weeks'} to keep weekly increases under 10%.` : undefined
      )
      router.refresh()
    } catch {
      setError('Network error. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="space-y-3 max-w-md w-full text-left"
      aria-busy={busy}
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <div className="space-y-1">
        <label htmlFor={goalId} className="block text-sm font-medium text-[var(--foreground)]">
          Goal
        </label>
        <input
          id={goalId}
          type="text"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="e.g. Marathon in 3h30"
          maxLength={300}
          disabled={busy}
          aria-describedby={`${goalId}-help`}
          className={inputCls}
        />
        <p id={`${goalId}-help`} className="text-xs text-[var(--muted-foreground)]">
          Context for the coach, does not set any numbers. Use the race fields below for distance and time.
        </p>
      </div>
      <div className="space-y-1">
        <label htmlFor={`${raceIdPrefix}-distance`} className="block text-sm font-medium text-[var(--foreground)]">
          Race distance
        </label>
        <select
          id={`${raceIdPrefix}-distance`}
          value={distance}
          onChange={(e) => setDistance(e.target.value as RaceDistance | '')}
          disabled={busy}
          className={inputCls}
        >
          {DISTANCE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      {distance === 'other' && (
        <div className="space-y-1">
          <label htmlFor={`${raceIdPrefix}-km`} className="block text-sm font-medium text-[var(--foreground)]">
            Distance in km
          </label>
          <input
            id={`${raceIdPrefix}-km`}
            type="number"
            inputMode="decimal"
            min={OTHER_DISTANCE_MIN_KM}
            max={OTHER_DISTANCE_MAX_KM}
            step="any"
            value={otherKm}
            onChange={(e) => setOtherKm(e.target.value)}
            required
            disabled={busy}
            placeholder={`${OTHER_DISTANCE_MIN_KM} to ${OTHER_DISTANCE_MAX_KM}`}
            className={inputCls}
          />
        </div>
      )}
      <div className="space-y-1">
        <label htmlFor={dateId} className="block text-sm font-medium text-[var(--foreground)]">
          {distance === '' ? 'Goal date (optional)' : 'Race date'}
        </label>
        <input
          id={dateId}
          type="date"
          value={goalDate}
          onChange={(e) => setGoalDate(e.target.value)}
          required={distance !== ''}
          disabled={busy}
          aria-describedby={`${dateId}-help`}
          className={inputCls}
        />
        <p id={`${dateId}-help`} className="text-xs text-[var(--muted-foreground)]">
          {distance === ''
            ? 'With a date the plan builds to it and tapers. Without one you get a general 12-week block.'
            : 'The race is always scheduled on this date, even if it is a Sunday or a day you did not tick as a training day.'}
        </p>
      </div>
      {distance !== '' && (
        <fieldset className="space-y-1" disabled={busy}>
          <legend className="block text-sm font-medium text-[var(--foreground)]">Target time (optional)</legend>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                ['h', hours, setHours, 99],
                ['min', minutes, setMinutes, 59],
                ['sec', seconds, setSeconds, 59],
              ] as const
            ).map(([unit, value, set, max]) => (
              <div key={unit} className="flex min-w-0 items-center gap-1">
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={max}
                  step={1}
                  value={value}
                  onChange={(e) => set(e.target.value)}
                  aria-label={`Target time ${unit === 'h' ? 'hours' : unit === 'min' ? 'minutes' : 'seconds'}`}
                  placeholder="0"
                  className={cn(inputCls, 'min-w-0 px-2')}
                />
                <span className="text-sm text-[var(--muted-foreground)]" aria-hidden>
                  {unit}
                </span>
              </div>
            ))}
          </div>
        </fieldset>
      )}
      <fieldset className="space-y-1" disabled={busy}>
        <legend className="block text-sm font-medium text-[var(--foreground)]">
          Days you cannot train (optional)
        </legend>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
          {WEEKDAY_NAMES.map((day) => {
            const checked = unavailable.includes(day)
            return (
              <label
                key={day}
                className={cn(
                  'flex min-h-11 cursor-pointer items-center justify-center rounded-md border px-2 text-sm capitalize',
                  checked
                    ? 'border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]'
                    : 'border-[var(--border)] text-[var(--foreground)]',
                  'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--ring)]'
                )}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={checked}
                  onChange={() =>
                    setUnavailable((cur) =>
                      cur.includes(day) ? cur.filter((d) => d !== day) : [...cur, day]
                    )
                  }
                  aria-label={day}
                />
                <span aria-hidden>{day.slice(0, 3)}</span>
              </label>
            )
          })}
        </div>
        <p className="text-xs text-[var(--muted-foreground)]">No sessions are scheduled on the selected days.</p>
      </fieldset>
      <div className="space-y-1">
        <label htmlFor={notesId} className="block text-sm font-medium text-[var(--foreground)]">
          Other constraints (optional)
        </label>
        <textarea
          id={notesId}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. 1 leisure session per week, no hard runs in May, travelling 12 to 16 June"
          maxLength={MAX_NOTES_LENGTH}
          rows={3}
          disabled={busy}
          aria-describedby={notesHelpId}
          className="w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-base text-[var(--foreground)]"
        />
        <p id={notesHelpId} className="text-xs text-[var(--muted-foreground)]">
          The coach follows these as closely as it can. Selected days above are strictly enforced; free text is best effort.{' '}
          {notes.length}/{MAX_NOTES_LENGTH}
        </p>
      </div>
      <div className="space-y-2">
        <Button
          type="button"
          variant="outline"
          className="min-h-11 w-full justify-between"
          aria-expanded={limitsOpen}
          aria-controls={`${raceIdPrefix}-limits`}
          onClick={() => setLimitsOpen((v) => !v)}
        >
          <span>Adjust limits</span>
          <span aria-hidden>{limitsOpen ? '−' : '+'}</span>
        </Button>
        {limitsOpen && (
          <fieldset id={`${raceIdPrefix}-limits`} className="space-y-3 rounded-md border border-[var(--border)] p-3" disabled={busy}>
            <legend className="px-1 text-sm font-medium text-[var(--foreground)]">Limits</legend>
            <p className="text-xs text-[var(--muted-foreground)]">
              {suggestionText}. Leave a field empty to use the suggestion. Values outside the allowed range are adjusted.
            </p>
            {(
              [
                ['Peak weekly km', maxWeekly, setMaxWeekly, suggested.defaults.maxWeeklyKm, suggested.bounds.maxWeeklyKm, 'km'],
                ['Longest run km', maxLong, setMaxLong, suggested.defaults.maxLongRunKm, suggested.bounds.maxLongRunKm, 'km'],
                ['Taper days', taper, setTaper, suggested.defaults.taperDays, suggested.bounds.taperDays, 'days'],
              ] as const
            ).map(([label, value, set, def, [lo, hi], unit]) => (
              <label key={label} className="block space-y-1">
                <span className="block text-sm text-[var(--foreground)]">{label}</span>
                <span className="flex items-center gap-2">
                  <input
                    type="number"
                    inputMode="numeric"
                    min={lo}
                    max={hi}
                    step={1}
                    value={value}
                    onChange={(e) => set(e.target.value)}
                    placeholder={String(def)}
                    aria-label={label}
                    className={cn(inputCls, 'min-w-0')}
                  />
                  <span className="shrink-0 text-xs text-[var(--muted-foreground)]">
                    {unit}, {lo} to {hi}
                  </span>
                </span>
              </label>
            ))}
            <Button type="button" variant="outline" className="min-h-11" disabled={!hasOverrides} onClick={resetLimits}>
              Reset to suggested
            </Button>
          </fieldset>
        )}
      </div>
      {error && (
        <p id={errId} role="alert" className="text-sm text-[var(--destructive)]">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full min-h-12" disabled={busy}>
        {busy ? 'Building your plan…' : replacing ? 'Regenerate plan' : 'Generate plan'}
      </Button>
      {busy && (
        <p role="status" className="text-xs text-[var(--muted-foreground)]">
          This can take up to a minute. Keep this page open.
        </p>
      )}
    </form>
  )
}
