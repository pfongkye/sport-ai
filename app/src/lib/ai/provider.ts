import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
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

/**
 * Resolves an AI SDK v4 LanguageModelV1 for the provider. If the user supplied
 * their own key, use it; else fall back to the system env key for that provider.
 *
 * Shared by the coach agent (`buildCoachAgent`) and the activity parser
 * (`parseActivity`) so both honour the user's provider/key selection.
 */
export function resolveModel(provider: AIProvider, modelId: string, userApiKey: string | null) {
  // The three provider factories return a LanguageModelV1 (AI SDK v4); the model
  // type is slightly different per provider, so hold it loosely for the shared
  // drift check below. The returned value preserves each provider's own type.
  const build = () => {
    switch (provider) {
      case 'anthropic': {
        const client = createAnthropic({ apiKey: userApiKey ?? process.env.ANTHROPIC_API_KEY })
        return client(modelId)
      }
      case 'google': {
        const client = createGoogleGenerativeAI({
          apiKey: userApiKey ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY,
        })
        return client(modelId)
      }
      case 'openai':
      default: {
        const client = createOpenAI({ apiKey: userApiKey ?? process.env.OPENAI_API_KEY })
        return client(modelId)
      }
    }
  }
  const model = build()
  warnOnModelVersionDrift(model)
  return model
}

/**
 * Preflight guard against the @ai-sdk/* version drift that silently breaks the
 * coach chat (see AGENTS.md #35). We pin AI SDK v4 (LanguageModelV1,
 * `specificationVersion: 'v1'`) to match @mastra/core@0.24. If a stray install
 * floats @ai-sdk/* to v5 (v2) or the responses variant (v3), the model's spec
 * version changes and Mastra's streamLegacy/stream gate rejects it → empty
 * responses. This logs ONCE, loudly, at the point the model is created so the
 * drift is obvious in logs instead of surfacing as a cryptic "No response".
 */
let versionWarned = false
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function warnOnModelVersionDrift(model: any): void {
  if (versionWarned) return
  const spec = model?.specificationVersion
  if (spec && spec !== 'v1') {
    versionWarned = true
    console.error(
      `[ai/provider] ⚠ @ai-sdk model specificationVersion is "${spec}" (expected "v1"). ` +
        `The installed @ai-sdk/* version has drifted from the pinned v4 line and is INCOMPATIBLE ` +
        `with @mastra/core@0.24 — the coach chat will return empty responses. Reinstall deps from ` +
        `the lockfile (in Docker: 'npm ci' in the app container). See AGENTS.md #35.`
    )
  }
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
