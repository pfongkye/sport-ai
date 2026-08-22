import type { CoreMessage } from 'ai'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { buildCoachAgent } from '@/lib/ai/agents/coach'
import { resolveUserAISettings } from '@/lib/ai/provider'
import { computeReadiness } from '@/lib/ai/readiness'

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
    computeReadiness(supabase, user.id),
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
