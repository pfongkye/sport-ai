import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { localDateInTz } from './dates'

/**
 * After an activity is saved, link it to a same-day, same-sport `pending`
 * planned session of the ACTIVE plan and mark that session `completed`
 * (spec Req 3.4). "Same day" is the athlete's local calendar day.
 *
 * Best-effort and NON-FATAL: never throws, returns the linked session id or
 * null. A failure here must never fail the activity save.
 */
export async function linkActivityToPlannedSession(
  supabase: SupabaseClient<Database>,
  userId: string,
  activity: { id: string; sportType: string; startedAt: string | Date }
): Promise<string | null> {
  try {
    const started = new Date(activity.startedAt)
    if (Number.isNaN(started.getTime())) return null

    const { data: settings } = await supabase
      .from('user_settings')
      .select('timezone')
      .eq('user_id', userId)
      .maybeSingle()
    const day = localDateInTz(started, settings?.timezone)

    const { data: plan } = await supabase
      .from('training_plans')
      .select('id')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!plan) return null

    const { data: match } = await supabase
      .from('planned_sessions')
      .select('id')
      .eq('user_id', userId)
      .eq('plan_id', plan.id)
      .eq('scheduled_date', day)
      .eq('sport_type', activity.sportType as Database['public']['Tables']['planned_sessions']['Row']['sport_type'])
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (!match) return null

    const { data: updated } = await supabase
      .from('planned_sessions')
      .update({ status: 'completed', completed_activity_id: activity.id })
      .eq('id', match.id)
      .eq('user_id', userId)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle()
    return updated?.id ?? null
  } catch (err) {
    console.warn('[plan/link-activity] skipped (non-fatal)', err)
    return null
  }
}
