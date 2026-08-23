import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

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

/** Format meters to km string */
export function formatDistance(meters: number, unit: 'metric' | 'imperial' = 'metric'): string {
  if (unit === 'imperial') {
    const miles = meters / 1609.34
    return `${miles.toFixed(2)} mi`
  }
  const km = meters / 1000
  return `${km.toFixed(2)} km`
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
// TODO(i18n): use the active locale (user_settings.language) instead of hardcoded en-GB.
export function formatDate(date: string | Date, format: 'short' | 'long' = 'short'): string {
  const d = typeof date === 'string' ? new Date(date) : date
  if (format === 'long') {
    return d.toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
  }
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Relative time (e.g. "2 days ago") */
export function timeAgo(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const diff = Date.now() - d.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return formatDate(d)
}
