import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Sidebar } from '@/components/layout/sidebar'
import { MobileHeader } from '@/components/layout/mobile-header'
import { MobileNav } from '@/components/layout/mobile-nav'
import { TimezoneSync } from '@/components/layout/timezone-sync'

/**
 * App shell layout — wraps all authenticated routes.
 * Provides sidebar (desktop) + mobile nav.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: settings } = await supabase
    .from('user_settings')
    .select('timezone')
    .eq('user_id', user.id)
    .maybeSingle()

  return (
    <div className="flex min-h-screen bg-[var(--background)]">
      <Sidebar />
      <main className="flex-1 flex flex-col min-w-0 pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-0">
        <MobileHeader />
        {children}
      </main>
      <MobileNav />
      <TimezoneSync settingsTimeZone={settings?.timezone ?? null} />
    </div>
  )
}
