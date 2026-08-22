import { Agent } from '@mastra/core/agent'
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
 * Builds a CoachAgent instance scoped to the current user and request.
 * Injects: typed tools, MCP servers, system prompt with user context.
 *
 * Model is passed as a provider-qualified string (e.g. "openai:gpt-4o")
 * so Mastra resolves it internally via its own AI SDK integration,
 * avoiding version mismatches between @ai-sdk/* and Mastra's bundled version.
 */
export async function buildCoachAgent(params: BuildCoachAgentParams): Promise<Agent> {
  const { supabase, userId, profile, settings, readiness } = params

  const provider: AIProvider = settings?.ai_provider ?? 'openai'
  const modelId = settings?.ai_model ?? 'gpt-4o'

  // Provider-qualified model string — Mastra resolves the SDK internally
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const model: any = `${provider}:${modelId}`

  // Build typed tools
  const tools = buildCoachTools(supabase, userId)

  // Build MCP client and inject its tools
  const mcpClient = createMCPClient()
  const mcpToolsets = await mcpClient.getToolsets()

  // Build system prompt with user context
  const instructions = buildCoachSystemPrompt({
    profile,
    settings,
    readiness,
    today: new Date().toISOString().slice(0, 10),
  })

  return new Agent({
    name: 'CoachAgent',
    instructions,
    model,
    tools: {
      ...tools,
      ...mcpToolsets,
    },
  })
}
