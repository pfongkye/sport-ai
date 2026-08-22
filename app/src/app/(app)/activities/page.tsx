import { createClient } from '@/lib/supabase/server'
import { ActivitiesView } from '@/components/activities/activities-view'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Activities' }

export default async function ActivitiesPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data: activities } = await supabase
    .from('activities')
    .select(
      'id, sport_type, source, started_at, duration_s, distance_m, elevation_gain_m, avg_hr_bpm, avg_pace_s_per_km, avg_cadence_rpm, training_load, notes'
    )
    .eq('user_id', user!.id)
    .order('started_at', { ascending: false })
    .limit(20)

  return <ActivitiesView initialActivities={activities ?? []} />
}
