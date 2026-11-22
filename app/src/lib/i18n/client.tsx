'use client'

import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { DEFAULT_LOCALE, type Locale } from './locales'
import { makeT, type TFunction } from './translate'

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE)

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>
}

export function useLocale(): Locale {
  return useContext(LocaleContext)
}

export function useT(): TFunction {
  const locale = useLocale()
  return useMemo(() => makeT(locale), [locale])
}
