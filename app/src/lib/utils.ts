import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { intlLocale, type Locale } from '@/lib/i18n/locales'
import { makeT } from '@/lib/i18n/translate'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Format seconds to MM:SS or HH:MM:SS */
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

/** Format pace in s/km to MM:SS /km */
export function formatPace(secondsPerKm: number): string {
  const m = Math.floor(secondsPerKm / 60)
  const s = secondsPerKm % 60
  return `${m}:${String(s).padStart(2, '0')} /km`
}

/** Fixed-decimal number in the locale's format (decimal comma in French). English keeps `toFixed`. */
export function formatNumber(value: number, digits = 1, locale: Locale = 'en'): string {
  if (locale === 'en') return value.toFixed(digits)
  return value.toLocaleString(intlLocale(locale), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    useGrouping: false,
  })
}

/** Format meters to km string */
export function formatDistance(
  meters: number,
  unit: 'metric' | 'imperial' = 'metric',
  locale: Locale = 'en'
): string {
  if (unit === 'imperial') {
    const miles = meters / 1609.34
    return `${formatNumber(miles, 2, locale)} mi`
  }
  const km = meters / 1000
  return `${formatNumber(km, 2, locale)} km`
}

/** Sport type → display label */
export const SPORT_LABELS: Record<string, string> = {
  run: 'Run',
  football: 'Football',
  gym: 'Gym',
  cycle: 'Cycle',
  other: 'Other',
}

/** Sport type → emoji */
export const SPORT_EMOJI: Record<string, string> = {
  run: '🏃',
  football: '⚽',
  gym: '🏋️',
  cycle: '🚴',
  other: '🏅',
}

/** Session type → display label */
export const SESSION_TYPE_LABELS: Record<string, string> = {
  easy: 'Easy Run',
  tempo: 'Tempo',
  'long run': 'Long Run',
  intervals: 'Intervals',
  rest: 'Rest',
  recovery: 'Recovery',
  football: 'Football',
  gym: 'Gym',
  race: 'Race',
}

/** Format a date to a readable string */
export function formatDate(
  date: string | Date,
  format: 'short' | 'long' = 'short',
  /** IANA zone to show the date in; omit to use the runtime's zone (UTC on the server). */
  timeZone?: string,
  /** Active locale; defaults to English (en-GB output, as before). */
  locale: Locale = 'en'
): string {
  const d = typeof date === 'string' ? new Date(date) : date
  if (format === 'long') {
    return d.toLocaleDateString(intlLocale(locale), {
      timeZone,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
  }
  return d.toLocaleDateString(intlLocale(locale), {
    timeZone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/** Relative time (e.g. "2 days ago") */
export function timeAgo(date: string | Date, timeZone?: string, locale: Locale = 'en'): string {
  const t = makeT(locale)
  const d = typeof date === 'string' ? new Date(date) : date
  const diff = Date.now() - d.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return t('time.justNow')
  if (mins < 60) return t('time.minutesAgo', { n: mins })
  const hours = Math.floor(mins / 60)
  if (hours < 24) return t('time.hoursAgo', { n: hours })
  const days = Math.floor(hours / 24)
  if (days < 7) return t('time.daysAgo', { n: days })
  return formatDate(d, 'short', timeZone, locale)
}
