import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { RouteSuggester } from '@/components/routes/route-suggester'

export const metadata: Metadata = { title: 'Routes' }

export default async function RoutesPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data: profile } = user
    ? await supabase.from('profiles').select('home_lat, home_lng').eq('id', user.id).maybeSingle()
    : { data: null }

  const hasHome =
    typeof profile?.home_lat === 'number' && typeof profile?.home_lng === 'number'

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-[var(--foreground)]">Routes</h1>
        <p className="text-sm text-[var(--muted-foreground)] mt-1">
          Get a round-trip running route for the distance and terrain you want, starting from
          your location, home, or any place.
        </p>
      </div>

      <RouteSuggester hasHome={hasHome} />
    </div>
  )
}
