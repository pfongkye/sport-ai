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
 * Resolves an AI SDK v5 LanguageModelV2 for the provider. If the user supplied
 * their own key, use it; else fall back to the system env key for that provider.
 *
 * Shared by the coach agent (`buildCoachAgent`) and the activity parser
 * (`parseActivity`) so both honour the user's provider/key selection.
 */
export function resolveModel(provider: AIProvider, modelId: string, userApiKey: string | null) {
  // The three provider factories return an AI SDK v5 LanguageModelV2; the model
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
 * Preflight guard against @ai-sdk/* version drift that would silently break the
 * coach chat (see AGENTS.md #35, now resolved). We pin the AI SDK v5-era line
 * (`@ai-sdk/openai@4` etc.), which produces a LanguageModelV2 whose
 * `specificationVersion` is a v5-generation value (empirically `'v4'` for
 * `@ai-sdk/openai@4.0.96`). @mastra/core@1.x's standard `agent.stream()` accepts
 * the v5 generation (v2/v3/v4) and REJECTS the legacy `'v1'` models (those are
 * for `streamLegacy()`, which we no longer call). If a stray install floats a
 * provider back to the AI SDK v4 line (`@ai-sdk/openai@1`, spec `'v1'`), the
 * standard stream gate throws and the chat breaks. This logs ONCE, loudly, at
 * model-creation time so drift is obvious in logs rather than a cryptic failure.
 */
const EXPECTED_SPEC_VERSIONS = new Set(['v2', 'v3', 'v4'])
let versionWarned = false
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function warnOnModelVersionDrift(model: any): void {
  if (versionWarned) return
  const spec = model?.specificationVersion
  if (spec && !EXPECTED_SPEC_VERSIONS.has(spec)) {
    versionWarned = true
    console.error(
      `[ai/provider] ⚠ @ai-sdk model specificationVersion is "${spec}" (expected a v5-era ` +
        `version: v2/v3/v4). The installed @ai-sdk/* version has drifted off the pinned v5 line ` +
        `and is INCOMPATIBLE with @mastra/core@1.x's standard agent.stream() — the coach chat ` +
        `will fail. Reinstall deps from the lockfile (in Docker: 'npm ci' in the app container). ` +
        `See AGENTS.md #35.`
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
