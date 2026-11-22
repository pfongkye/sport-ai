import { cache } from 'react'
import { cookies, headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { LANG_COOKIE, resolveLocale, type Locale } from './locales'
import { makeT } from './translate'

/** Locale for this request: user_settings.language > cookie > Accept-Language > en. Cached per request. */
export const getLocale = cache(async (): Promise<Locale> => {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()])
  const cookie = cookieStore.get(LANG_COOKIE)?.value
  const acceptLanguage = headerStore.get('accept-language')

  let preference: string | null = null
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (user) {
      const { data } = await supabase
        .from('user_settings')
        .select('language')
        .eq('user_id', user.id)
        .maybeSingle()
      preference = data?.language ?? null
    }
  } catch {
    // Settings unreachable: fall back to cookie / header.
  }
  return resolveLocale({ preference, cookie, acceptLanguage })
})

export async function getT() {
  const locale = await getLocale()
  return { locale, t: makeT(locale) }
}
