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
 * Streaming model note: the stack runs the AI SDK v5-era line
 * (`@ai-sdk/openai@4` etc. → a LanguageModelV2) with `@mastra/core@1.x`. Mastra
 * 1.x has a single standard streaming API — `agent.stream()` — for v5 models;
 * the old v1/v2 `stream()`/`streamLegacy()` ambiguity (and the detection shim
 * that lived here) is gone. `streamAgentText()` below just calls
 * `agent.stream()` directly. See AGENTS.md #33/#35 for the history.
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
    id: 'CoachAgent',
    name: 'CoachAgent',
    instructions,
    model,
    tools,
  })
}

/**
 * Stream an agent reply as a text stream.
 *
 * Mastra 1.x exposes one standard streaming API, `agent.stream()`, for AI SDK
 * v5 models (our pinned `@ai-sdk/openai@4` etc.). It returns a
 * `MastraModelOutput` whose `.textStream` is an async iterable of string chunks,
 * which the chat and insight routes consume directly. (The old
 * `stream()`/`streamLegacy()` version-detection shim is gone — there is exactly
 * one correct method now that the stack is v5-only. See AGENTS.md #33/#35.)
 *
 * Options:
 *  - `maxSteps: 6` lets the model continue past a tool call to a final text
 *    answer (Mastra's standard `stream()` accepts `maxSteps` directly; we use
 *    it rather than `stopWhen: stepCountIs(n)` because `stepCountIs` from our
 *    top-level `ai@7` yields a `StopCondition` whose generic shape doesn't match
 *    the one Mastra expects via its bundled `ai-v5` alias — `maxSteps` is the
 *    equivalent, type-clean option).
 *  - `onError` logs loop errors that would otherwise be INVISIBLE: a tool-call
 *    error (e.g. invalid tool arguments) ends the turn with empty text and no
 *    route-level exception — this log is how we catch it. Kept permanently;
 *    it's cheap and the one signal that surfaces silent failures.
 */
export async function streamAgentText(
  agent: Agent,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  messages: any
): Promise<{ textStream: AsyncIterable<string> }> {
  return agent.stream(messages, {
    maxSteps: 6,
    onError: ({ error }: { error: Error | string }) => {
      console.error(
        '[ai/agent] stream onError:',
        error instanceof Error ? error.stack || error.message : String(error)
      )
    },
  })
}
