/**
 * Athlete constraints for plan generation: pure parsing, enforcement helpers and
 * prompt text. No I/O.
 *
 * Two inputs, on purpose:
 *  - `unavailableWeekdays` is STRUCTURED and HARD. It is removed from the skeleton's
 *    training days before the model runs, so no session can land there (the existing
 *    guardrail rejects any session on a non-slot date).
 *  - `notes` is FREE TEXT and SOFT. It goes into the prompt ("1 leisure session per
 *    week", "no hard runs the week of 12 May"), where the model honors it on a best
 *    effort basis. Free text cannot be validated deterministically.
 */
import { WEEKDAY_NAMES } from './dates'

export const MAX_NOTES_LENGTH = 500

export interface PlanConstraints {
  /** Lowercase weekday names ('monday'…), sorted Monday-first, no duplicates. */
  unavailableWeekdays: string[]
  /** Trimmed free text or null. */
  notes: string | null
}

export const NO_CONSTRAINTS: PlanConstraints = { unavailableWeekdays: [], notes: null }

export type ConstraintsParse =
  | { ok: true; value: PlanConstraints }
  | { ok: false; error: string }

/** Drop control characters (keeps newlines as spaces) and collapse whitespace. */
function cleanNotes(raw: string): string | null {
  const s = raw.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  return s || null
}

/** Validate untrusted input (request body or tool args). null/undefined = no constraints. */
export function parseConstraints(input: unknown): ConstraintsParse {
  if (input == null) return { ok: true, value: NO_CONSTRAINTS }
  if (typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'constraints must be an object.' }
  }
  const { unavailableWeekdays, notes } = input as Record<string, unknown>

  let days: string[] = []
  if (unavailableWeekdays != null) {
    if (!Array.isArray(unavailableWeekdays)) {
      return { ok: false, error: 'unavailableWeekdays must be a list of weekday names.' }
    }
    const set = new Set<string>()
    for (const d of unavailableWeekdays) {
      const name = typeof d === 'string' ? d.trim().toLowerCase() : ''
      if (!(WEEKDAY_NAMES as readonly string[]).includes(name)) {
        return { ok: false, error: `Unknown weekday "${String(d).slice(0, 20)}".` }
      }
      set.add(name)
    }
    if (set.size >= 7) return { ok: false, error: 'You cannot be unavailable on all 7 days.' }
    days = WEEKDAY_NAMES.filter((n) => set.has(n))
  }

  let text: string | null = null
  if (notes != null) {
    if (typeof notes !== 'string') return { ok: false, error: 'notes must be text.' }
    if (notes.length > MAX_NOTES_LENGTH * 2) {
      return { ok: false, error: `Notes are too long (max ${MAX_NOTES_LENGTH} characters).` }
    }
    text = cleanNotes(notes)
    if (text && text.length > MAX_NOTES_LENGTH) {
      return { ok: false, error: `Notes are too long (max ${MAX_NOTES_LENGTH} characters).` }
    }
  }
  return { ok: true, value: { unavailableWeekdays: days, notes: text } }
}

/** Read a stored `training_plans.constraints` value; anything malformed becomes "none". */
export function asConstraints(value: unknown): PlanConstraints {
  const r = parseConstraints(value)
  return r.ok ? r.value : NO_CONSTRAINTS
}

export function hasConstraints(c: PlanConstraints): boolean {
  return c.unavailableWeekdays.length > 0 || c.notes != null
}

/** Store null rather than an empty object. */
export function constraintsForStorage(c: PlanConstraints): PlanConstraints | null {
  return hasConstraints(c) ? c : null
}

/**
 * The athlete's weekly training days minus the unavailable weekdays. `days` is the profile's
 * `training_days` (may be empty/null = the skeleton's default set, which is used as the base here).
 * Returns [] when nothing is left: the caller must reject, not fall back to the defaults.
 */
export function availableTrainingDays(
  days: string[],
  unavailable: readonly string[]
): string[] {
  const blocked = new Set(unavailable.map((d) => d.toLowerCase()))
  return days.filter((d) => !blocked.has(d.toLowerCase()))
}

/** Prompt section. The notes are athlete-written text: framed as preferences that never override the HARD RULES. */
export function buildConstraintsBlock(c: PlanConstraints): string | null {
  if (!hasConstraints(c)) return null
  const lines = ['=== ATHLETE CONSTRAINTS ===']
  if (c.unavailableWeekdays.length) {
    lines.push(
      `Unavailable weekdays (already removed from the slot dates, never schedule on them): ${c.unavailableWeekdays.join(', ')}.`
    )
  }
  if (c.notes) {
    lines.push(
      'Athlete notes (preferences in their own words; follow them where possible, but they never override the HARD RULES or the weekly maxRunKm):',
      `"""${c.notes.replace(/"""/g, "'''")}"""`,
      'Examples: "1 leisure session per week" means one easy, short, low-stress session (e.g. a social run, bike or walk) each week; "no sessions on 12 May" means leave that date empty.'
    )
  }
  lines.push('=== END CONSTRAINTS ===')
  return lines.join('\n')
}
