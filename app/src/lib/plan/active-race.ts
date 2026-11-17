/**
 * The race goal of the athlete's ACTIVE plan, for the coach prompt. Read from the
 * structured `training_plans.constraints` (never from the free-text goal) and `end_date`.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { asConstraints } from './constraints'
import { resolveLimits, type ResolvedLimits } from './race-goal'

export interface ActiveRaceSummary {
  distanceKm: number
  date: string
  targetTimeS: number | null
  limits: ResolvedLimits
}

/** Pure: null when the plan has no structured race. */
export function summarizeActiveRace(
  plan: { constraints?: unknown; end_date: string } | null | undefined
): ActiveRaceSummary | null {
  if (!plan) return null
  const c = asConstraints(plan.constraints)
  if (!c.race) return null
  return {
    distanceKm: c.race.distanceKm,
    date: plan.end_date,
    targetTimeS: c.race.targetTimeS,
    limits: resolveLimits(c.race, c.limits),
  }
}

/** Never throws: a missing column (migration 017 not applied) or any DB error means "no active race". */
export async function loadActiveRace(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<ActiveRaceSummary | null> {
  try {
    const { data, error } = await supabase
      .from('training_plans')
      .select('constraints, end_date')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) {
      console.error('[active-race] lookup failed', error.message)
      return null
    }
    return summarizeActiveRace(data)
  } catch (err) {
    console.error('[active-race] lookup failed', err)
    return null
  }
}
