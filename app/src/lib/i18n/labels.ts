import { SESSION_TYPE_LABELS, SPORT_LABELS } from '@/lib/utils'
import type { DictKey } from './dictionaries/en'
import type { TFunction } from './translate'

/** Localised sport name. Unknown values are shown as stored (data, not UI text). */
export function sportLabel(t: TFunction, sport: string): string {
  const key = `sport.${sport}` as DictKey
  return sport in SPORT_LABELS ? t(key) : sport
}

/** Localised session type. Unknown values (free text from the AI) are shown as stored. */
export function sessionTypeLabel(t: TFunction, type: string): string {
  const key = `sessionType.${type.toLowerCase()}` as DictKey
  return type.toLowerCase() in SESSION_TYPE_LABELS ? t(key) : type
}
