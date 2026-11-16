import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { loadActivePlan } from '@/lib/plan/load-plan'
import { readTzCookie } from '@/lib/plan/request-timezone'
import { PlanView } from '@/components/plan/plan-view'

export const metadata: Metadata = { title: 'Training Plan' }

export default async function PlanPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const cookieTz = await readTzCookie()
  const [active, profile] = user
    ? await Promise.all([
        loadActivePlan(supabase, user.id, new Date(), cookieTz).catch(() => null),
        supabase.from('profiles').select('primary_goal').eq('id', user.id).maybeSingle(),
      ])
    : [null, { data: null }]

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-6xl short-landscape:max-w-none">
      <div>
        <h1 className="text-2xl font-bold text-[var(--foreground)]">Training Plan</h1>
        <p className="text-sm text-[var(--muted-foreground)] mt-1">
          Your week-by-week plan toward your goal. Move or delete a session if life gets in the way.
        </p>
      </div>
      <PlanView active={active} defaultGoal={profile.data?.primary_goal ?? ''} />
    </div>
  )
}
