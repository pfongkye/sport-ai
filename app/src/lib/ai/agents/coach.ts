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
  // Mastra's streaming APIs are model-version specific: `streamLegacy()` for v1
  // models (AI SDK v4, specificationVersion 'v1') and `stream()` for v2 (AI SDK
  // v5). Calling the wrong one errors — and crucially that error can be thrown
  // at the await OR deferred until the textStream is iterated. The deferred case
  // is invisible to a try/catch around the call and surfaced downstream as an
  // EMPTY stream (the "No response. Try again." prod bug: stream() was called on
  // a v1 model, didn't throw at the await, so the fallback never ran).
  //
  // Fix: DECIDE up front from the model's own specificationVersion rather than
  // probe-and-catch. Our pinned AI SDK v4 produces v1 → streamLegacy(). A single
  // cross-method retry remains as a safety net if detection disagrees with what
  // the API accepts (when the error IS thrown at the await).
  const isWrongMethodError = (err: unknown): boolean => {
    const msg = err instanceof Error ? err.message : String(err)
    return /not supported for streamLegacy|not compatible with stream\(\)|use AI SDK v5 models|use stream instead|use the .*streamLegacy/i.test(
      msg
    )
  }

  let specVersion: string | undefined
  try {
    const llm = await agent.getLLM()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    specVersion = (llm.getModel() as any)?.specificationVersion
  } catch {
    // couldn't introspect — fall through to the v1 default below
  }
  console.error('[splitdbg] streamAgentText specVersion=', specVersion)

  // TEMP INSTRUMENTATION [splitdbg] — lifecycle callbacks to see where a
  // tool-calling turn dies in prod. Remove after diagnosis.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dbgOpts: any = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onStepFinish: (step: any) => {
      try {
        console.error(
          '[splitdbg] onStepFinish',
          JSON.stringify({
            finishReason: step?.finishReason,
            text: typeof step?.text === 'string' ? step.text.slice(0, 60) : undefined,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            toolCalls: (step?.toolCalls ?? []).map((t: any) => t?.toolName),
            toolResults: (step?.toolResults ?? []).length,
          })
        )
      } catch (e) {
        console.error('[splitdbg] onStepFinish log err', e)
      }
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onFinish: (res: any) => {
      console.error(
        '[splitdbg] onFinish',
        JSON.stringify({
          finishReason: res?.finishReason,
          textLen: typeof res?.text === 'string' ? res.text.length : undefined,
          steps: res?.steps?.length,
          usage: res?.usage,
        })
      )
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => {
      console.error('[splitdbg] onError', e?.error instanceof Error ? e.error.stack || e.error.message : JSON.stringify(e))
    },
    maxSteps: 6,
  }

  if (specVersion === 'v2') {
    try {
      return await agent.stream(messages, dbgOpts)
    } catch (err) {
      if (isWrongMethodError(err)) return agent.streamLegacy(messages, dbgOpts)
      throw err
    }
  }

  // v1 or unknown (our pinned v4 default) → streamLegacy().
  try {
    return await agent.streamLegacy(messages, dbgOpts)
  } catch (err) {
    if (isWrongMethodError(err)) return agent.stream(messages, dbgOpts)
    throw err
  }
}
