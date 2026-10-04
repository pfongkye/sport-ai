import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { StravaSettings } from '@/components/strava/strava-settings'

export const metadata: Metadata = { title: 'Settings' }

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ strava?: string }>
}) {
  const { strava } = await searchParams
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data: connection } = user
    ? await supabase
        .from('strava_connections')
        .select('athlete_firstname, athlete_lastname, athlete_username, last_synced_at')
        .eq('user_id', user.id)
        .maybeSingle()
    : { data: null }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-[var(--foreground)]">Settings</h1>
        <p className="text-sm text-[var(--muted-foreground)] mt-1">
          Connect data sources and manage your preferences.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-[var(--muted-foreground)] uppercase tracking-wide">
          Integrations
        </h2>
        <StravaSettings initialConnection={connection ?? null} initialStatus={strava} />
      </section>
    </div>
  )
}
