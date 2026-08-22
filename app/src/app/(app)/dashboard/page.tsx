import { createClient } from '@/lib/supabase/server'
import { formatDistance, formatDuration, SPORT_EMOJI, timeAgo } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Dashboard' }

export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const [{ data: profile }, { data: recentActivities }, { data: thisWeek }] = await Promise.all([
    supabase
      .from('profiles')
      .select('display_name, primary_goal, sport_prefs')
      .eq('id', user!.id)
      .single(),
    supabase
      .from('activities')
      .select(
        'id, sport_type, started_at, duration_s, distance_m, avg_hr_bpm, avg_pace_s_per_km, training_load'
      )
      .eq('user_id', user!.id)
      .order('started_at', { ascending: false })
      .limit(5),
    supabase
      .from('activities')
      .select('sport_type, duration_s, distance_m, training_load')
      .eq('user_id', user!.id)
      .gte('started_at', getWeekStart()),
  ])

  const weeklyKm = (thisWeek ?? [])
    .filter((a) => a.sport_type === 'run' || a.sport_type === 'cycle')
    .reduce((sum, a) => sum + (a.distance_m ?? 0), 0) / 1000

  const weeklyHours =
    (thisWeek ?? []).reduce((sum, a) => sum + (a.duration_s ?? 0), 0) / 3600

  const weeklySessions = thisWeek?.length ?? 0

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-4xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-[var(--foreground)]">
          Hey {profile?.display_name ?? 'Athlete'} 👋
        </h1>
        {profile?.primary_goal && (
          <p className="text-sm text-[var(--muted-foreground)] mt-1">
            Goal: {profile.primary_goal}
          </p>
        )}
      </div>

      {/* This week summary */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-[var(--muted-foreground)] font-medium uppercase tracking-wide">
              This week
            </p>
            <p className="text-2xl font-bold mt-1">{weeklyKm.toFixed(1)}</p>
            <p className="text-xs text-[var(--muted-foreground)]">km</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-[var(--muted-foreground)] font-medium uppercase tracking-wide">
              Time
            </p>
            <p className="text-2xl font-bold mt-1">{weeklyHours.toFixed(1)}</p>
            <p className="text-xs text-[var(--muted-foreground)]">hours</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-[var(--muted-foreground)] font-medium uppercase tracking-wide">
              Sessions
            </p>
            <p className="text-2xl font-bold mt-1">{weeklySessions}</p>
            <p className="text-xs text-[var(--muted-foreground)]">workouts</p>
          </CardContent>
        </Card>
      </div>

      {/* Placeholder cards — filled in later phases */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* Readiness placeholder */}
        <Card className="border-dashed">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-[var(--muted-foreground)]">
              Readiness Score
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-[var(--muted-foreground)]">
              Available after your first activity upload.
            </p>
          </CardContent>
        </Card>

        {/* Training plan placeholder */}
        <Card className="border-dashed">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-[var(--muted-foreground)]">
              Today's Session
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-[var(--muted-foreground)]">
              No active training plan.{' '}
              <Link href="/plan" className="text-[var(--primary)] hover:underline">
                Generate one →
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>

      {/* AI Coach CTA */}
      <Card className="bg-[var(--primary)]/5 border-[var(--primary)]/20">
        <CardContent className="pt-4 flex items-center justify-between gap-4">
          <div>
            <p className="font-medium text-[var(--foreground)]">Ask your AI Coach</p>
            <p className="text-sm text-[var(--muted-foreground)] mt-0.5">
              Voice or text — get personalised coaching advice
            </p>
          </div>
          <Link
            href="/coach"
            className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] text-white px-4 py-2 text-sm font-medium hover:bg-[var(--primary)]/90 transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-4" aria-hidden>
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            Chat
          </Link>
        </CardContent>
      </Card>

      {/* Recent activities */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-[var(--foreground)]">Recent activities</h2>
          <Link
            href="/activities"
            className="text-sm text-[var(--primary)] hover:underline"
          >
            View all
          </Link>
        </div>

        {!recentActivities?.length ? (
          <Card className="border-dashed">
            <CardContent className="py-8 text-center">
              <p className="text-sm text-[var(--muted-foreground)]">No activities yet.</p>
              <Link
                href="/activities"
                className="mt-2 inline-block text-sm text-[var(--primary)] hover:underline"
              >
                Upload your first workout →
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {recentActivities.map((activity) => (
              <Link key={activity.id} href={`/activities/${activity.id}`}>
                <Card className="hover:bg-[var(--muted)]/40 transition-colors cursor-pointer">
                  <CardContent className="py-3 px-4 flex items-center gap-3">
                    <span className="text-2xl" aria-hidden>
                      {SPORT_EMOJI[activity.sport_type] ?? '🏅'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium capitalize">
                          {activity.sport_type}
                        </span>
                        <span className="text-xs text-[var(--muted-foreground)]">
                          {timeAgo(activity.started_at)}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 text-xs text-[var(--muted-foreground)]">
                        {activity.distance_m && (
                          <span>{formatDistance(activity.distance_m)}</span>
                        )}
                        {activity.duration_s && (
                          <span>{formatDuration(activity.duration_s)}</span>
                        )}
                        {activity.avg_hr_bpm && (
                          <span>{activity.avg_hr_bpm} bpm</span>
                        )}
                      </div>
                    </div>
                    {activity.training_load && (
                      <Badge variant="secondary" className="shrink-0 text-xs">
                        Load {Math.round(activity.training_load)}
                      </Badge>
                    )}
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function getWeekStart(): string {
  const d = new Date()
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1) // Monday
  d.setDate(diff)
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}
