import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { isLocale, SUPPORTED_LOCALES, type Locale } from './locales'

export type SetLanguageResult =
  | { ok: true; language: Locale }
  | { ok: false; status: 400 | 500; error: string }

/**
 * Persist the athlete's language on their own `user_settings` row (RLS-scoped client).
 * Only 'en' and 'fr' are accepted. Existing messages and plans are never touched.
 * `user_settings.language` already exists (migration 007), so no migration is needed. The row is created at signup by a trigger (007), like the timezone update.
 */
export async function setUserLanguage(
  supabase: SupabaseClient<Database>,
  userId: string,
  language: unknown
): Promise<SetLanguageResult> {
  if (!isLocale(language)) {
    return { ok: false, status: 400, error: `language must be one of: ${SUPPORTED_LOCALES.join(', ')}.` }
  }
  const { error } = await supabase
    .from('user_settings')
    .update({ language })
    .eq('user_id', userId)
  if (error) return { ok: false, status: 500, error: 'Failed to save language.' }
  return { ok: true, language }
}
