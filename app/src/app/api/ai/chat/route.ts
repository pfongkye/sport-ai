import type { CoreMessage } from 'ai'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { buildCoachAgent } from '@/lib/ai/agents/coach'
import { resolveUserAISettings } from '@/lib/ai/provider'
import type { ReadinessResult } from '@/types/activity'

export const runtime = 'nodejs' // Mastra + MCP need Node APIs
export const maxDuration = 60

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/**
 * POST /api/ai/chat
 * Body: { messages: {role, content}[] } — full turn history from the client.
 * Streams the assistant reply as plain text chunks (text/plain stream).
 * Persists the latest user message and the full assistant reply.
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })

  let body: { messages?: ChatMessage[] }
  try {
    body = await request.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 })
  }

  const messages = (body.messages ?? []).filter(
    (m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string'
  )
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')
  if (!lastUser) {
    return new Response(JSON.stringify({ error: 'No user message' }), { status: 400 })
  }

  // Load user context in parallel
  const [{ data: profile }, aiSettings, readiness] = await Promise.all([
    supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single()
      .then((r) => ({ data: r.data })),
    resolveUserAISettings(user.id),
    computeReadiness(user.id),
  ])

  let agent
  try {
    agent = await buildCoachAgent({
      supabase,
      userId: user.id,
      profile: profile ?? null,
      settings: aiSettings.settings,
      readiness,
      userApiKey: aiSettings.userApiKey,
    })
  } catch (err) {
    console.error('[ai/chat] failed to build agent', err)
    return new Response(
      JSON.stringify({ error: 'AI is not configured. Add an API key in Settings.' }),
      { status: 500 }
    )
  }

  // Persist the user's message immediately
  await supabase.from('coaching_messages').insert({
    user_id: user.id,
    role: 'user',
    content: lastUser.content,
  })

  // Stream the agent reply (AI SDK v4 model → streamLegacy).
  // messages are {role,content} — a valid AI SDK v4 CoreMessage[].
  let result
  try {
    result = await agent.streamLegacy(
      messages.map((m) => ({ role: m.role, content: m.content })) as CoreMessage[]
    )
  } catch (err) {
    console.error('[ai/chat] stream failed', err)
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'AI request failed' }),
      { status: 502 }
    )
  }

  // Tee the text stream: forward to client, accumulate for persistence.
  const encoder = new TextEncoder()
  let full = ''
  const admin = await createAdminClient()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of result.textStream) {
          full += chunk
          controller.enqueue(encoder.encode(chunk))
        }
      } catch (err) {
        console.error('[ai/chat] mid-stream error', err)
      } finally {
        controller.close()
        // Persist assistant reply (best-effort) using admin client so it isn't
        // tied to the request lifecycle/RLS cookie after the stream ends.
        if (full.trim()) {
          await admin.from('coaching_messages').insert({
            user_id: user.id,
            role: 'assistant',
            content: full,
          })
        }
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  })
}

/**
 * Compute a lightweight readiness snapshot (ATL/CTL/TSB) from recent activities.
 * Mirrors the getTrainingLoad tool so the system prompt can be readiness-aware.
 */
async function computeReadiness(userId: string): Promise<ReadinessResult | null> {
  const supabase = await createAdminClient()
  const since = new Date()
  since.setDate(since.getDate() - 42)

  const { data } = await supabase
    .from('activities')
    .select('started_at, training_load')
    .eq('user_id', userId)
    .gte('started_at', since.toISOString())

  const activities = data ?? []
  if (!activities.length) return null

  const dailyLoad: Record<string, number> = {}
  for (const a of activities) {
    const day = a.started_at.slice(0, 10)
    dailyLoad[day] = (dailyLoad[day] ?? 0) + (a.training_load ?? 0)
  }

  const atlDecay = 1 - Math.exp(-1 / 7)
  const ctlDecay = 1 - Math.exp(-1 / 42)
  let atl = 0
  let ctl = 0
  for (let i = 41; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const load = dailyLoad[d.toISOString().slice(0, 10)] ?? 0
    atl += atlDecay * (load - atl)
    ctl += ctlDecay * (load - ctl)
  }
  const tsb = ctl - atl
  const score = Math.max(0, Math.min(100, Math.round(50 + tsb * 2)))
  const label: ReadinessResult['label'] =
    tsb > 15 ? 'Fresh' : tsb > 0 ? 'Optimal' : tsb > -20 ? 'Tired' : 'Very Fatigued'
  const message =
    tsb < -20
      ? 'Significant fatigue — prioritise recovery.'
      : tsb > 15
        ? 'Well rested — good day for quality work.'
        : 'Balanced training load.'

  return { atl: +atl.toFixed(1), ctl: +ctl.toFixed(1), tsb: +tsb.toFixed(1), score, label, message }
}
