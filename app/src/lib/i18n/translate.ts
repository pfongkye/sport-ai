import { en, type DictKey, type Dictionary } from './dictionaries/en'
import { fr } from './dictionaries/fr'
import type { Locale } from './locales'

const dictionaries: Record<Locale, Dictionary> = { en, fr }

export type TranslateParams = Record<string, string | number>
export type TFunction = (key: DictKey, params?: TranslateParams) => string

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale]
}

/** Replace `{name}` placeholders. Unknown placeholders are left as written. */
export function interpolate(template: string, params?: TranslateParams): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m))
}

export function makeT(locale: Locale): TFunction {
  const dict = dictionaries[locale]
  return (key, params) => interpolate(dict[key] ?? en[key] ?? key, params)
}
