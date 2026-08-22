import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { OnboardingForm } from './onboarding-form'

export const metadata = {
  title: 'Set up your profile — SportAI',
}

export default async function OnboardingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, primary_goal')
    .eq('id', user.id)
    .single()

  // Already onboarded
  if (profile?.display_name && profile?.primary_goal) {
    redirect('/dashboard')
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-[var(--background)] px-4 py-12">
      <div className="w-full max-w-lg space-y-8">
        <div className="space-y-2">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-[var(--primary)] text-white text-xl font-bold shadow-md mb-1">
            S
          </div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Set up your profile</h1>
          <p className="text-sm text-[var(--muted-foreground)]">
            Tell us about yourself so we can build your personalised training plan.
          </p>
        </div>
        <OnboardingForm userId={user.id} />
      </div>
    </main>
  )
}
