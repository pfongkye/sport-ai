import { createAdminClient } from '@/lib/supabase/server'
import type { AIProvider, UserSettings } from '@/types/database'

/**
 * Fetches user AI settings and decrypts their API key server-side.
 * Returns null for userApiKey if the user hasn't configured one.
 */
export async function resolveUserAISettings(userId: string): Promise<{
  settings: UserSettings | null
  userApiKey: string | null
}> {
  const supabase = await createAdminClient()

  const { data: settings, error } = await supabase
    .from('user_settings')
    .select('ai_provider, ai_model, ai_api_key_enc, units, language, timezone, updated_at, user_id')
    .eq('user_id', userId)
    .single()

  if (error || !settings) {
    return { settings: null, userApiKey: null }
  }

  let userApiKey: string | null = null

  if (settings?.ai_api_key_enc) {
    try {
      // Decrypt using pgcrypto server-side function
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: decrypted } = await supabase.rpc('decrypt_api_key' as any, {
        key_enc: settings.ai_api_key_enc,
      })
      userApiKey = decrypted as string | null
    } catch {
      // Key decryption failed — fall back to system default silently
      userApiKey = null
    }
  }

  return { settings, userApiKey }
}

/** Provider → default model mapping */
export const DEFAULT_MODELS: Record<AIProvider, string> = {
  openai: 'gpt-4o',
  anthropic: 'claude-3-5-sonnet-20241022',
  google: 'gemini-1.5-pro',
  mistral: 'mistral-large-latest',
}

/** All available models per provider */
export const AVAILABLE_MODELS: Record<AIProvider, { id: string; label: string }[]> = {
  openai: [
    { id: 'gpt-4o', label: 'GPT-4o' },
    { id: 'gpt-4o-mini', label: 'GPT-4o Mini (faster, cheaper)' },
    { id: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
  ],
  anthropic: [
    { id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' },
    { id: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku (faster)' },
    { id: 'claude-3-opus-20240229', label: 'Claude 3 Opus' },
  ],
  google: [
    { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
    { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash (faster)' },
    { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
  ],
  mistral: [
    { id: 'mistral-large-latest', label: 'Mistral Large' },
    { id: 'mistral-small-latest', label: 'Mistral Small (faster)' },
  ],
}
