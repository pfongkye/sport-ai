/**
 * Locale primitives. Pure (no Next.js imports) so server, client and tests share them.
 * The same value is stored in `user_settings.language` and mirrored in the LANG_COOKIE.
 */
export const SUPPORTED_LOCALES = ['en', 'fr'] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'en'
export const LANG_COOKIE = 'lang'
export const LANG_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value)
}

/** Pick the first supported language from an Accept-Language header (q-values respected). */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null
  const ranked = header
    .split(',')
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(';')
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='))
      const weight = q ? Number(q.slice(2)) : 1
      return { tag: tag.trim().toLowerCase(), weight: Number.isFinite(weight) ? weight : 0, index }
    })
    .filter((x) => x.tag && x.tag !== '*' && x.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index)
  for (const { tag } of ranked) {
    const base = tag.split('-')[0]
    if (isLocale(base)) return base
  }
  return null
}

/**
 * Locale precedence: saved preference (user_settings.language) > cookie >
 * Accept-Language (first visit) > English. Invalid values are skipped, never thrown.
 */
export function resolveLocale(input: {
  preference?: unknown
  cookie?: unknown
  acceptLanguage?: string | null
}): Locale {
  if (isLocale(input.preference)) return input.preference
  if (isLocale(input.cookie)) return input.cookie
  return localeFromAcceptLanguage(input.acceptLanguage) ?? DEFAULT_LOCALE
}

/** BCP 47 tag for Intl formatting. Keeps the previous English output (en-GB dates). */
export function intlLocale(locale: Locale): string {
  return locale === 'fr' ? 'fr-FR' : 'en-GB'
}

/** BCP 47 tag for the Web Speech API (recognition and synthesis). */
export function speechLang(locale: Locale): string {
  return locale === 'fr' ? 'fr-FR' : 'en-US'
}

export const LANGUAGE_NAMES: Record<Locale, string> = { en: 'English', fr: 'French' }
/** Names shown in the picker, in their own language. */
export const LANGUAGE_NATIVE_NAMES: Record<Locale, string> = { en: 'English', fr: 'Français' }

/**
 * Instruction appended to every AI text generation. The reply language follows the
 * saved preference, NOT the language the athlete writes or speaks in.
 */
export function replyLanguageInstruction(language: unknown): string {
  const locale = isLocale(language) ? language : DEFAULT_LOCALE
  return `Always reply in ${LANGUAGE_NAMES[locale]}, regardless of the language the athlete writes or speaks in. Keep tool names, tool arguments, ids and enum values (such as sport and session types) unchanged.`
}
