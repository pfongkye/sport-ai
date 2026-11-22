'use client'

import { useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import { http } from '@/lib/http'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useLocale, useT } from '@/lib/i18n/client'
import { weekdayName } from './plan-format'
import type { DictKey } from '@/lib/i18n/dictionaries/en'
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

const DISTANCE_OPTIONS: { value: RaceDistance | ''; key: DictKey }[] = [
  { value: '', key: 'plan.form.noRace' },
  { value: '5k', key: 'plan.form.d5k' },
  { value: '10k', key: 'plan.form.d10k' },
  { value: 'half', key: 'plan.form.dHalf' },
  { value: 'marathon', key: 'plan.form.dMarathon' },
  { value: 'other', key: 'plan.form.dOther' },
]

/** Name of the distance inside "Suggested for {name}". */
const DISTANCE_NAME_KEY: Record<RaceDistance, DictKey> = {
  '5k': 'plan.form.d5k',
  '10k': 'plan.form.d10k',
  half: 'plan.form.forHalf',
  marathon: 'plan.form.forMarathon',
  other: 'plan.form.forThisDistance',
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
  const t = useT()
  const locale = useLocale()
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
    distance === ''
      ? t('plan.form.forGeneral')
      : distance === 'other'
        ? raceKm != null
          ? t('plan.form.forKm', { km: formatRaceKm(raceKm) })
          : t('plan.form.forThisDistance')
        : t(DISTANCE_NAME_KEY[distance])
  const suggestionText =
    t('plan.form.suggested', {
      name: distanceName,
      weekly: suggested.defaults.maxWeeklyKm,
      long: suggested.defaults.maxLongRunKm,
    }) + (distance === '' ? '' : t('plan.form.suggestedTaper', { days: suggested.defaults.taperDays }))
  const hasOverrides = maxWeekly.trim() !== '' || maxLong.trim() !== '' || taper.trim() !== ''

  function resetLimits() {
    setMaxWeekly('')
    setMaxLong('')
    setTaper('')
  }

  async function submit() {
    if (timeInvalid) {
      setError(t('plan.form.timeWholeNumbers'))
      return
    }
    if (replacing && !window.confirm(t('plan.form.confirmReplace'))) return
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
        setError(json.error ?? t('plan.form.failed'))
        return
      }
      const n = json.adjustments?.length ?? 0
      onDone?.(
        t('plan.form.created', { sessions: json.sessionCount ?? 0, weeks: json.weeks ?? 0 }),
        n ? t(n === 1 ? 'plan.form.adjustedOne' : 'plan.form.adjustedMany', { n }) : undefined
      )
      router.refresh()
    } catch {
      setError(t('common.networkError'))
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
          {t('plan.form.goal')}
        </label>
        <input
          id={goalId}
          type="text"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder={t('plan.form.goalPlaceholder')}
          maxLength={300}
          disabled={busy}
          aria-describedby={`${goalId}-help`}
          className={inputCls}
        />
        <p id={`${goalId}-help`} className="text-xs text-[var(--muted-foreground)]">
          {t('plan.form.goalHelp')}
        </p>
      </div>
      <div className="space-y-1">
        <label htmlFor={`${raceIdPrefix}-distance`} className="block text-sm font-medium text-[var(--foreground)]">
          {t('plan.form.raceDistance')}
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
              {t(o.key)}
            </option>
          ))}
        </select>
      </div>
      {distance === 'other' && (
        <div className="space-y-1">
          <label htmlFor={`${raceIdPrefix}-km`} className="block text-sm font-medium text-[var(--foreground)]">
            {t('plan.form.distanceKm')}
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
            placeholder={t('plan.form.rangeKm', { min: OTHER_DISTANCE_MIN_KM, max: OTHER_DISTANCE_MAX_KM })}
            className={inputCls}
          />
        </div>
      )}
      <div className="space-y-1">
        <label htmlFor={dateId} className="block text-sm font-medium text-[var(--foreground)]">
          {distance === '' ? t('plan.form.goalDateOptional') : t('plan.form.raceDate')}
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
          {distance === '' ? t('plan.form.goalDateHelp') : t('plan.form.raceDateHelp')}
        </p>
      </div>
      {distance !== '' && (
        <fieldset className="space-y-1" disabled={busy}>
          <legend className="block text-sm font-medium text-[var(--foreground)]">{t('plan.form.targetTime')}</legend>
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
                  aria-label={t(unit === 'h' ? 'plan.form.targetHours' : unit === 'min' ? 'plan.form.targetMinutes' : 'plan.form.targetSeconds')}
                  placeholder="0"
                  className={cn(inputCls, 'min-w-0 px-2')}
                />
                <span className="text-sm text-[var(--muted-foreground)]" aria-hidden>
                  {t(unit === 'h' ? 'plan.form.unitH' : unit === 'min' ? 'plan.form.unitMin' : 'plan.form.unitSec')}
                </span>
              </div>
            ))}
          </div>
        </fieldset>
      )}
      <fieldset className="space-y-1" disabled={busy}>
        <legend className="block text-sm font-medium text-[var(--foreground)]">
          {t('plan.form.unavailable')}
        </legend>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
          {WEEKDAY_NAMES.map((day, dayIndex) => {
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
                  aria-label={weekdayName(dayIndex, locale)}
                />
                <span aria-hidden>{weekdayName(dayIndex, locale, 'short')}</span>
              </label>
            )
          })}
        </div>
        <p className="text-xs text-[var(--muted-foreground)]">{t('plan.form.unavailableHelp')}</p>
      </fieldset>
      <div className="space-y-1">
        <label htmlFor={notesId} className="block text-sm font-medium text-[var(--foreground)]">
          {t('plan.form.constraints')}
        </label>
        <textarea
          id={notesId}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={t('plan.form.constraintsPlaceholder')}
          maxLength={MAX_NOTES_LENGTH}
          rows={3}
          disabled={busy}
          aria-describedby={notesHelpId}
          className="w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-base text-[var(--foreground)]"
        />
        <p id={notesHelpId} className="text-xs text-[var(--muted-foreground)]">
          {t('plan.form.constraintsHelp')}{' '}
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
          <span>{t('plan.form.adjustLimits')}</span>
          <span aria-hidden>{limitsOpen ? '−' : '+'}</span>
        </Button>
        {limitsOpen && (
          <fieldset id={`${raceIdPrefix}-limits`} className="space-y-3 rounded-md border border-[var(--border)] p-3" disabled={busy}>
            <legend className="px-1 text-sm font-medium text-[var(--foreground)]">{t('plan.form.limits')}</legend>
            <p className="text-xs text-[var(--muted-foreground)]">
              {t('plan.form.limitsHelp', { suggestion: suggestionText })}
            </p>
            {(
              [
                [t('plan.form.peakWeekly'), maxWeekly, setMaxWeekly, suggested.defaults.maxWeeklyKm, suggested.bounds.maxWeeklyKm, t('unit.km')],
                [t('plan.form.longestRun'), maxLong, setMaxLong, suggested.defaults.maxLongRunKm, suggested.bounds.maxLongRunKm, t('unit.km')],
                [t('plan.form.taperDays'), taper, setTaper, suggested.defaults.taperDays, suggested.bounds.taperDays, t('plan.form.unitDays')],
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
                    {t('plan.form.unitRange', { unit, lo, hi })}
                  </span>
                </span>
              </label>
            ))}
            <Button type="button" variant="outline" className="min-h-11" disabled={!hasOverrides} onClick={resetLimits}>
              {t('plan.form.reset')}
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
        {busy ? t('plan.form.building') : replacing ? t('plan.regenerate') : t('plan.form.generate')}
      </Button>
      {busy && (
        <p role="status" className="text-xs text-[var(--muted-foreground)]">
          {t('plan.form.buildingHelp')}
        </p>
      )}
    </form>
  )
}
