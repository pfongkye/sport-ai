/**
 * Structured race goal and per-distance training limits. Pure, no I/O.
 *
 * Everything here comes from STRUCTURED input (a distance picker, a time, numeric overrides).
 * Free text is never parsed for distances or times.
 *
 * NOTE FOR REVIEWERS: the numbers in DISTANCE_PROFILES are general coaching rules of thumb
 * (peak weekly volume, long-run ceiling, taper length). They were NOT taken from a looked-up
 * source and should be reviewed by a coach. The athlete can adjust all three through
 * LimitOverrides; overrides are clamped to a band around the default so a typo cannot
 * produce an unsafe plan.
 */

export const RACE_DISTANCES = ['5k', '10k', 'half', 'marathon', 'other'] as const
export type RaceDistance = (typeof RACE_DISTANCES)[number]

export interface RaceGoal {
  distance: RaceDistance
  /** Race length in km (5, 10, 21.0975, 42.195 for the standard distances). */
  distanceKm: number
  /** Goal finish time in seconds, or null when the athlete has none. */
  targetTimeS: number | null
}

export interface LimitOverrides {
  maxWeeklyKm?: number | null
  maxLongRunKm?: number | null
  taperDays?: number | null
}

export const STANDARD_DISTANCE_KM: Record<Exclude<RaceDistance, 'other'>, number> = {
  '5k': 5,
  '10k': 10,
  half: 21.0975,
  marathon: 42.195,
}

export const OTHER_DISTANCE_MIN_KM = 3
export const OTHER_DISTANCE_MAX_KM = 100
/** A target time must imply a pace between these (s/km): 2:00 to 20:00 per km. */
export const MIN_TARGET_PACE_S = 120
export const MAX_TARGET_PACE_S = 1200
/** Above this an 'other' distance is treated as an ultra. */
export const ULTRA_THRESHOLD_KM = 42.2

export interface DistanceProfile {
  /** Peak weekly run km a plan for this distance may reach. */
  maxWeeklyKm: number
  /** Longest single run in km. */
  maxLongRunKm: number
  /** Share of the weekly load the long run may take. */
  longRunShare: number
  /** The taper starts about this many days before the race. */
  taperDays: number
}

export type ProfileKey = '5k' | '10k' | 'half' | 'marathon' | 'ultra' | 'general'

/** Default limits per distance. General (no race) keeps the behavior from before race goals existed. */
export const DISTANCE_PROFILES: Record<ProfileKey, DistanceProfile> = {
  '5k': { maxWeeklyKm: 50, maxLongRunKm: 14, longRunShare: 0.35, taperDays: 5 },
  '10k': { maxWeeklyKm: 55, maxLongRunKm: 18, longRunShare: 0.35, taperDays: 8 },
  half: { maxWeeklyKm: 70, maxLongRunKm: 22, longRunShare: 0.35, taperDays: 12 },
  marathon: { maxWeeklyKm: 100, maxLongRunKm: 32, longRunShare: 0.35, taperDays: 18 },
  ultra: { maxWeeklyKm: 110, maxLongRunKm: 40, longRunShare: 0.4, taperDays: 18 },
  general: { maxWeeklyKm: 110, maxLongRunKm: 32, longRunShare: 0.35, taperDays: 0 },
}

/** Absolute ceilings no override can pass. */
export const ABS_MAX_WEEKLY_KM = 110
export const ABS_MAX_LONG_RUN_KM = 50
export const MAX_TAPER_DAYS = 21
/** Override band around the default: [0.4 x default, 1.3 x default], capped by the absolute max. */
export const OVERRIDE_MIN_FACTOR = 0.4
export const OVERRIDE_MAX_FACTOR = 1.3

export function profileKeyFor(race: RaceGoal | null): ProfileKey {
  if (!race) return 'general'
  if (race.distance !== 'other') return race.distance
  const km = race.distanceKm
  if (km > ULTRA_THRESHOLD_KM) return 'ultra'
  if (km <= 5) return '5k'
  if (km <= 10) return '10k'
  if (km <= STANDARD_DISTANCE_KM.half) return 'half'
  return 'marathon'
}

const round1 = (n: number) => Math.round(n * 10) / 10
const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi)

/** Run-length cap for non-race runs in the race week: 60% of the race, between 3 and 8 km. */
export function raceWeekRunCapKm(raceKm: number): number {
  return clamp(Math.round(raceKm * 0.6), 3, 8)
}

export interface ResolvedLimits {
  maxWeeklyKm: number
  maxLongRunKm: number
  longRunShare: number
  taperDays: number
  /** Cap for non-race runs in the race week; null without a race. */
  raceWeekRunCapKm: number | null
  defaults: { maxWeeklyKm: number; maxLongRunKm: number; taperDays: number }
  bounds: {
    maxWeeklyKm: [number, number]
    maxLongRunKm: [number, number]
    taperDays: [number, number]
  }
}

/** Defaults for the distance, overridden by the athlete's values clamped to the allowed bands. */
export function resolveLimits(
  race: RaceGoal | null,
  overrides: LimitOverrides | null | undefined
): ResolvedLimits {
  const p = DISTANCE_PROFILES[profileKeyFor(race)]
  const band = (def: number, abs: number): [number, number] => [
    Math.round(OVERRIDE_MIN_FACTOR * def),
    Math.min(Math.round(OVERRIDE_MAX_FACTOR * def), abs),
  ]
  const weeklyBand = band(p.maxWeeklyKm, ABS_MAX_WEEKLY_KM)
  const longBand = band(p.maxLongRunKm, ABS_MAX_LONG_RUN_KM)
  const pick = (v: number | null | undefined, def: number, [lo, hi]: [number, number]) =>
    typeof v === 'number' && Number.isFinite(v) ? round1(clamp(v, lo, hi)) : def
  return {
    maxWeeklyKm: pick(overrides?.maxWeeklyKm, p.maxWeeklyKm, weeklyBand),
    maxLongRunKm: pick(overrides?.maxLongRunKm, p.maxLongRunKm, longBand),
    longRunShare: p.longRunShare,
    taperDays: Math.round(pick(overrides?.taperDays, p.taperDays, [0, MAX_TAPER_DAYS])),
    raceWeekRunCapKm: race ? raceWeekRunCapKm(race.distanceKm) : null,
    defaults: { maxWeeklyKm: p.maxWeeklyKm, maxLongRunKm: p.maxLongRunKm, taperDays: p.taperDays },
    bounds: { maxWeeklyKm: weeklyBand, maxLongRunKm: longBand, taperDays: [0, MAX_TAPER_DAYS] },
  }
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }

/** Validate an untrusted race goal. null/undefined = no race. Standard distances ignore any supplied distanceKm. */
export function parseRaceGoal(input: unknown): ParseResult<RaceGoal | null> {
  if (input == null) return { ok: true, value: null }
  if (typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'race must be an object.' }
  }
  const { distance, distanceKm, targetTimeS } = input as Record<string, unknown>
  if (typeof distance !== 'string' || !(RACE_DISTANCES as readonly string[]).includes(distance)) {
    return { ok: false, error: `Race distance must be one of ${RACE_DISTANCES.join(', ')}.` }
  }
  const d = distance as RaceDistance
  let km: number
  if (d === 'other') {
    if (
      typeof distanceKm !== 'number' ||
      !Number.isFinite(distanceKm) ||
      distanceKm < OTHER_DISTANCE_MIN_KM ||
      distanceKm > OTHER_DISTANCE_MAX_KM
    ) {
      return {
        ok: false,
        error: `For another distance, give its length in km (${OTHER_DISTANCE_MIN_KM} to ${OTHER_DISTANCE_MAX_KM}).`,
      }
    }
    km = Math.round(distanceKm * 100) / 100
  } else {
    km = STANDARD_DISTANCE_KM[d]
  }

  let time: number | null = null
  if (targetTimeS != null) {
    if (typeof targetTimeS !== 'number' || !Number.isInteger(targetTimeS) || targetTimeS <= 0) {
      return { ok: false, error: 'The target time must be a whole number of seconds.' }
    }
    const pace = targetTimeS / km
    if (pace < MIN_TARGET_PACE_S || pace > MAX_TARGET_PACE_S) {
      return { ok: false, error: 'That target time is not realistic for this distance.' }
    }
    time = targetTimeS
  }
  return { ok: true, value: { distance: d, distanceKm: km, targetTimeS: time } }
}

/** Validate untrusted limit overrides. null/undefined or all-empty = none. Clamping happens in resolveLimits. */
export function parseLimitOverrides(input: unknown): ParseResult<LimitOverrides | null> {
  if (input == null) return { ok: true, value: null }
  if (typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'limits must be an object.' }
  }
  const r = input as Record<string, unknown>
  const out: LimitOverrides = {}
  const fields: [keyof LimitOverrides, string, boolean][] = [
    ['maxWeeklyKm', 'Peak weekly km', false],
    ['maxLongRunKm', 'Longest run km', false],
    ['taperDays', 'Taper days', true],
  ]
  for (const [key, label, allowZero] of fields) {
    const v = r[key]
    if (v == null) continue
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || (!allowZero && v === 0) || v > 1000) {
      return { ok: false, error: `${label} must be a positive number.` }
    }
    out[key] = v
  }
  return { ok: true, value: Object.keys(out).length ? out : null }
}

/** 'h:mm:ss' from one hour up, 'm:ss' below. */
export function formatTargetTime(totalS: number): string {
  const s = Math.round(totalS)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const two = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`
}

/** Goal pace as 'm:ss' per km. */
export function goalPaceLabel(targetTimeS: number, distanceKm: number): string {
  const p = Math.round(targetTimeS / distanceKm)
  return `${Math.floor(p / 60)}:${String(p % 60).padStart(2, '0')}`
}

/** Coach-facing sentence when the athlete's recent volume is above the weekly limit (the plan starts lower); '' otherwise. */
export function baselineReducedNote(baselineKm: number, maxWeeklyKm: number): string {
  return baselineKm > maxWeeklyKm
    ? `The athlete's recent volume (${baselineKm} km/week) is above the ${maxWeeklyKm} km/week limit for this goal, so the plan starts at ${maxWeeklyKm}; say so. `
    : ''
}

/** '10', '21.1', '42.2': at most one decimal. */
export function formatRaceKm(km: number): string {
  return String(round1(km))
}
