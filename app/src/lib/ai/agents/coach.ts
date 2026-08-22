import { Agent } from '@mastra/core/agent'
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, AIProvider, Profile, UserSettings } from '@/types/database'
import type { ReadinessResult } from '@/types/activity'
import { buildCoachTools } from '../tools'
import { buildCoachSystemPrompt } from '../prompts/coach'
import { createMCPClient } from '@/lib/mcp/client'

interface BuildCoachAgentParams {
  supabase: SupabaseClient<Database>
  userId: string
  profile: Profile | null
  settings: UserSettings | null
  readiness: ReadinessResult | null
  /** User's decrypted API key — null means use system default */
  userApiKey: string | null
}

/**
 * Builds a CoachAgent scoped to the current user and request.
 * Injects typed tools, MCP servers, and a context-aware system prompt.
 *
 * Uses AI SDK v4 provider factories (@ai-sdk/*@1), which produce
 * LanguageModelV1 — the type Mastra 0.24 (ai@4) consumes. Stream via
 * `agent.streamLegacy()`.
 */
export async function buildCoachAgent(params: BuildCoachAgentParams): Promise<Agent> {
  const { supabase, userId, profile, settings, readiness, userApiKey } = params

  const provider: AIProvider = settings?.ai_provider ?? 'openai'
  const modelId = settings?.ai_model ?? 'gpt-4o'
  const model = resolveModel(provider, modelId, userApiKey)

  const tools = buildCoachTools(supabase, userId)

  const mcpClient = createMCPClient()
  let mcpTools = {}
  try {
    mcpTools = await mcpClient.getToolsets()
  } catch {
    // MCP servers (uvx) may be unavailable in some environments — degrade
    // gracefully to typed tools only rather than failing the whole chat.
    mcpTools = {}
  }

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
    tools: { ...tools, ...mcpTools },
  })
}

/**
 * Resolves an AI SDK v4 LanguageModelV1 for the provider.
 * If the user supplied their own key, use it; else fall back to the
 * system env key for that provider.
 */
function resolveModel(provider: AIProvider, modelId: string, userApiKey: string | null) {
  switch (provider) {
    case 'anthropic': {
      const client = createAnthropic({
        apiKey: userApiKey ?? process.env.ANTHROPIC_API_KEY,
      })
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
      const client = createOpenAI({
        apiKey: userApiKey ?? process.env.OPENAI_API_KEY,
      })
      return client(modelId)
    }
  }
}
