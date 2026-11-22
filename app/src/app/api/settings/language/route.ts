import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { setUserLanguage } from '@/lib/i18n/set-language'
import { LANG_COOKIE, LANG_COOKIE_MAX_AGE } from '@/lib/i18n/locales'

export const runtime = 'nodejs'

/**
 * PATCH /api/settings/language
 * Body: { language: 'en' | 'fr' }
 * Saves the preference on the caller's user_settings row and mirrors it in the `lang`
 * cookie (so the root layout can set <html lang> and signed-out pages follow it).
 */
export async function PATCH(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { language?: unknown }
  try {
    body = (await request.json()) as { language?: unknown }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const result = await setUserLanguage(supabase, user.id, body?.language)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  const res = NextResponse.json({ language: result.language })
  res.cookies.set(LANG_COOKIE, result.language, {
    path: '/',
    maxAge: LANG_COOKIE_MAX_AGE,
    sameSite: 'lax',
  })
  return res
}
