import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ActivityDetail } from '@/components/activities/activity-detail'
import { readTzCookie } from '@/lib/plan/request-timezone'
import { getAthleteTimezone } from '@/lib/plan/session-guard'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Activity' }

export default async function ActivityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data: activity } = await supabase
    .from('activities')
    .select('*')
    .eq('id', id)
    .eq('user_id', user!.id)
    .single()

  if (!activity) notFound()

  const { data: streams } = await supabase
    .from('activity_streams')
    .select('stream_type, data')
    .eq('activity_id', id)
    .eq('user_id', user!.id)

  const timeZone = await getAthleteTimezone(supabase, user!.id, await readTzCookie())
  return <ActivityDetail activity={activity} streams={streams ?? []} timeZone={timeZone} />
}
