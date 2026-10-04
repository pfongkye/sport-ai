import { Agent } from '@mastra/core/agent'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, AIProvider, Profile, UserSettings } from '@/types/database'
import type { ReadinessResult } from '@/types/activity'
import { buildCoachTools } from '../tools'
import { buildCoachSystemPrompt } from '../prompts/coach'
import { resolveModel } from '../provider'

interface BuildCoachAgentParams {
  supabase: SupabaseClient<Database>
  userId: string
  profile: Profile | null
  settings: UserSettings | null
  readiness: ReadinessResult | null
  /** User's decrypted API key — null means use system default */
  userApiKey: string | null
  /** Service-role client — required by the Strava tools (token decryption). */
  admin?: SupabaseClient<Database>
}

/**
 * Builds a CoachAgent scoped to the current user and request.
 * Injects typed tools and a context-aware system prompt.
 *
 * Model version note: depending on which @ai-sdk/* versions are installed in a
 * given environment, the provider factory may produce a v1 (AI SDK v4) or v2
 * (AI SDK v5) model. Mastra's streaming APIs are version-specific
 * (`streamLegacy()` = v1, `stream()` = v2) and throw on a mismatch. Use the
 * `streamAgentText()` helper below, which detects the model version and calls
 * the correct one, so routes don't have to care.
 *
 * NOTE: MCP servers were intentionally NOT wired here. Typed tools (safe,
 * RLS-enforced, testable, deploy-anywhere) cover our needs, and stdio-based MCP
 * (uvx) can't run on Vercel. If open-ended stats/web/memory are needed later,
 * prefer adding typed tools or a remote (HTTP) MCP service. See AGENTS.md.
 */
export async function buildCoachAgent(params: BuildCoachAgentParams): Promise<Agent> {
  const { supabase, userId, profile, settings, readiness, userApiKey, admin } = params

  const provider: AIProvider = settings?.ai_provider ?? 'openai'
  const modelId = settings?.ai_model ?? 'gpt-4o'
  const model = resolveModel(provider, modelId, userApiKey)

  const tools = buildCoachTools(supabase, userId, admin)

  const instructions = buildCoachSystemPrompt({
    profile,
    settings,
    readiness,
    today: new Date().toISOString().slice(0, 10),
  })

  return new Agent({
    name: 'CoachAgent',
    instructions,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    model: model as any,
    tools,
  })
}

/**
 * Stream an agent reply as a text stream, picking the right Mastra API for the
 * model's AI SDK version:
 *   - v1 models (LanguageModelV1, AI SDK v4) → `streamLegacy()`
 *   - v2 models (LanguageModelV2, AI SDK v5) → `stream()`
 * Mastra throws if you call the wrong one for the model's `specificationVersion`
 * (e.g. "V2 models are not supported for streamLegacy"), and which version the
 * installed `@ai-sdk/*` factories produce can differ between environments
 * (host vs the Docker container's own node_modules — see AGENTS.md). Detecting
 * at runtime makes the chat/insight routes work regardless.
 *
 * Both APIs expose `.textStream`, so callers consume the result identically.
 */
export async function streamAgentText(
  agent: Agent,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  messages: any
): Promise<{ textStream: AsyncIterable<string> }> {
  // The model's reported `specificationVersion` (e.g. 'v3' for openai.responses)
  // does NOT map cleanly onto Mastra's v1/v2 stream gate, and which value you
  // get differs by environment (host vs the Docker container's node_modules).
  // So instead of predicting, we TRY one method and, only if Mastra rejects it
  // with its specific "wrong method for this model version" error, fall back to
  // the other. Any other error propagates unchanged.
  const isWrongMethodError = (err: unknown): boolean => {
    const msg = err instanceof Error ? err.message : String(err)
    return /not supported for streamLegacy|not compatible with stream\(\)|use AI SDK v5 models|use stream instead|use the .*streamLegacy/i.test(
      msg
    )
  }

  try {
    return await agent.stream(messages)
  } catch (err) {
    if (isWrongMethodError(err)) {
      return agent.streamLegacy(messages)
    }
    throw err
  }
}
