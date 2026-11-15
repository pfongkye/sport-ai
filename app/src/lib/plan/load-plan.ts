import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, TrainingPlan } from '@/types/database'
import { getAthleteTimezone } from './session-guard'
import { localDateInTz } from './dates'

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
  plan: Pick<TrainingPlan, 'id' | 'title' | 'goal' | 'start_date' | 'end_date' | 'status'>
  sessions: PlanSessionRow[]
  /** Today's date in the athlete's timezone. */
  today: string
  timezone: string
}

const SESSION_COLUMNS =
  'id, scheduled_date, sport_type, session_type, description, target_distance_m, target_duration_s, target_hr_zone, status, completed_activity_id, ai_notes'

/**
 * The athlete's active plan and its sessions ordered by date, or null when
 * there is none. Shared by `GET /api/plan` and the /plan server page.
 */
export async function loadActivePlan(
  supabase: SupabaseClient<Database>,
  userId: string,
  now: Date = new Date()
): Promise<ActivePlan | null> {
  const { data: plan, error } = await supabase
    .from('training_plans')
    .select('id, title, goal, start_date, end_date, status')
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

  const timezone = await getAthleteTimezone(supabase, userId)
  return {
    plan,
    sessions: (sessions ?? []) as PlanSessionRow[],
    today: localDateInTz(now, timezone),
    timezone,
  }
}
