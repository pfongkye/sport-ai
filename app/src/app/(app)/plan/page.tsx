import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { loadActivePlan } from '@/lib/plan/load-plan'
import { readTzCookie } from '@/lib/plan/request-timezone'
import { getT } from '@/lib/i18n/server'
import { PlanView } from '@/components/plan/plan-view'

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT()
  return { title: t('plan.title') }
}

export default async function PlanPage() {
  const { t } = await getT()
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
        <h1 className="text-2xl font-bold text-[var(--foreground)]">{t('plan.title')}</h1>
        <p className="text-sm text-[var(--muted-foreground)] mt-1">
          {t('plan.subtitle')}
        </p>
      </div>
      <PlanView active={active} defaultGoal={profile.data?.primary_goal ?? ''} />
    </div>
  )
}
