import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, TrainingPlan } from '@/types/database'
import { getAthleteTimezone } from './session-guard'
import { addDays, localDateInTz, mondayOf } from './dates'
import { bucketActivities, type PlanActivity, type RawActivity } from './day-items'
import { asConstraints, type PlanConstraints } from './constraints'
import { asRecap, type TrainingRecap } from '@/lib/ai/workflows/training-recap'

export interface PlanSessionRow {
  id: string
  scheduled_date: string
  sport_type: Database['public']['Tables']['planned_sessions']['Row']['sport_type']
  session_type: string | null
  description: string | null
  target_distance_m: number | null
  target_duration_s: number | null
  target_hr_zone: number | null
  status: Database['public']['Tables']['planned_sessions']['Row']['status']
  completed_activity_id: string | null
  ai_notes: string | null
}

export interface ActivePlan {
  plan: Pick<TrainingPlan, 'id' | 'title' | 'goal' | 'start_date' | 'end_date' | 'status'> & {
    /** Recap snapshot the plan was built from; null for plans created before recaps were stored. */
    recap: TrainingRecap | null
    /** What the athlete asked for when generating (migration 017); empty for older plans. */
    constraints: PlanConstraints
  }
  sessions: PlanSessionRow[]
  /** Logged activities in the plan weeks not linked to a session, with their athlete-local date. */
  activities: PlanActivity[]
  /** Today's date in the athlete's timezone. */
  today: string
  timezone: string
}

export const ACTIVITY_COLUMNS =
  'id, sport_type, started_at, duration_s, distance_m, avg_pace_s_per_km, avg_hr_bpm, source'

const SESSION_COLUMNS =
  'id, scheduled_date, sport_type, session_type, description, target_distance_m, target_duration_s, target_hr_zone, status, completed_activity_id, ai_notes'

/**
 * The athlete's active plan and its sessions ordered by date, or null when
 * there is none. Shared by `GET /api/plan` and the /plan server page.
 */
export async function loadActivePlan(
  supabase: SupabaseClient<Database>,
  userId: string,
  now: Date = new Date(),
  cookieTz?: string | null
): Promise<ActivePlan | null> {
  const { data: plan, error } = await supabase
    .from('training_plans')
    .select('id, title, goal, start_date, end_date, status, recap, constraints')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`Failed to load plan: ${error.message}`)
  if (!plan) return null

  const { data: sessions, error: sErr } = await supabase
    .from('planned_sessions')
    .select(SESSION_COLUMNS)
    .eq('user_id', userId)
    .eq('plan_id', plan.id)
    .order('scheduled_date', { ascending: true })
  if (sErr) throw new Error(`Failed to load plan sessions: ${sErr.message}`)

  const timezone = await getAthleteTimezone(supabase, userId, cookieTz)
  const rows = (sessions ?? []) as PlanSessionRow[]

  // Whole plan weeks (Monday-first, as the calendar shows them), padded by a day
  // each side so activities near local midnight are bucketed by local date below.
  const first = rows.length ? [plan.start_date, rows[0].scheduled_date].sort()[0] : plan.start_date
  const last = rows.length ? [plan.end_date, rows[rows.length - 1].scheduled_date].sort().slice(-1)[0] : plan.end_date
  const from = mondayOf(first)
  const to = addDays(mondayOf(last), 6)
  const { data: acts, error: aErr } = await supabase
    .from('activities')
    .select(ACTIVITY_COLUMNS)
    .eq('user_id', userId)
    .gte('started_at', `${addDays(from, -1)}T00:00:00Z`)
    .lte('started_at', `${addDays(to, 2)}T00:00:00Z`)
    .order('started_at', { ascending: false })
    .limit(1000)
  if (aErr) throw new Error(`Failed to load activities: ${aErr.message}`)
  const linked = rows.map((s) => s.completed_activity_id).filter((id): id is string => !!id)

  return {
    plan: { ...plan, recap: asRecap(plan.recap), constraints: asConstraints(plan.constraints) },
    sessions: rows,
    activities: bucketActivities((acts ?? []) as RawActivity[], timezone, linked, { from, to }),
    today: localDateInTz(now, timezone),
    timezone,
  }
}
