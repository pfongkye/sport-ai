import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { LoginForm } from './login-form'
import { getT } from '@/lib/i18n/server'

export const metadata = {
  title: 'Sign in — SportAI',
  description: 'Sign in to your SportAI coaching account',
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirectTo?: string; error?: string }>
}) {
  const { t } = await getT()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (user) redirect('/dashboard')

  const { redirectTo, error } = await searchParams

  return (
    <main className="min-h-screen flex items-center justify-center bg-[var(--background)] px-4">
      <div className="w-full max-w-sm space-y-8">
        {/* Logo + heading */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[var(--primary)] text-white text-2xl font-bold shadow-lg mb-2">
            S
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--foreground)]">
            SportAI
          </h1>
          <p className="text-sm text-[var(--muted-foreground)]">
            {t('login.tagline')}
          </p>
        </div>

        {/* Error banner */}
        {error && (
          <div
            role="alert"
            className="rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-400"
          >
            {error === 'auth_callback_failed'
              ? t('login.authFailed')
              : error === 'not_allowed'
                ? t('login.notAllowed')
                : decodeURIComponent(error)}
          </div>
        )}

        <LoginForm redirectTo={redirectTo} />

        <p className="text-center text-xs text-[var(--muted-foreground)]">
          {t('login.agreePrefix')}{' '}
          <a href="/terms" className="underline hover:text-[var(--foreground)]">
            {t('login.terms')}
          </a>{' '}
          {t('login.and')}{' '}
          <a href="/privacy" className="underline hover:text-[var(--foreground)]">
            {t('login.privacy')}
          </a>
          .
        </p>
      </div>
    </main>
  )
}
