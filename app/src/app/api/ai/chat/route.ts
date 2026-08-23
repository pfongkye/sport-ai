import type { CoreMessage } from 'ai'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { buildCoachAgent } from '@/lib/ai/agents/coach'
import { resolveUserAISettings } from '@/lib/ai/provider'
import { computeReadiness } from '@/lib/ai/readiness'
import { retrieveRelevantContext, embedForStorage } from '@/lib/ai/memory'

export const runtime = 'nodejs' // Mastra + MCP need Node APIs
export const maxDuration = 60

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Safety-net cap on how many prior messages we forward to the LLM per turn.
 * The client sends the full thread, which grows unbounded → rising token cost
 * and eventual context-limit errors. We keep only the most recent slice.
 *
 * This is a blunt recency window, NOT real memory — durable facts and semantic
 * recall are handled by RAG (see Task 2.10 in the spec). Once RAG lands, older
 * context is recovered by retrieval rather than by sending the whole thread.
 */
const MAX_CONTEXT_MESSAGES = 20
/** Hard cap per message to avoid a single huge paste blowing the window. */
const MAX_MESSAGE_CHARS = 8000

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

  const allMessages = (body.messages ?? [])
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_CHARS) }))

  const lastUser = [...allMessages].reverse().find((m) => m.role === 'user')
  if (!lastUser) {
    return new Response(JSON.stringify({ error: 'No user message' }), { status: 400 })
  }

  // Safety net: only send the most recent window to the LLM. Always keep the
  // final message (the current user turn). Real long-term memory comes from RAG
  // (Task 2.10) — this just bounds token cost / prevents context overflow now.
  const messages =
    allMessages.length > MAX_CONTEXT_MESSAGES
      ? allMessages.slice(-MAX_CONTEXT_MESSAGES)
      : allMessages

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

  const admin = await createAdminClient()

  // RAG: retrieve relevant past context for this query and embed the user
  // message for storage — both best-effort, run in parallel.
  const [retrievedContext, userEmbedding] = await Promise.all([
    retrieveRelevantContext(admin, user.id, lastUser.content, aiSettings.userApiKey),
    embedForStorage(lastUser.content, aiSettings.userApiKey),
  ])

  // Persist the user's message immediately (tagged as chat, with embedding).
  await supabase.from('coaching_messages').insert({
    user_id: user.id,
    role: 'user',
    content: lastUser.content,
    metadata: { kind: 'chat' },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    embedding: userEmbedding as any,
  })

  // Prepend retrieved memory as a system message so the agent can recall
  // things from outside the recent window.
  const llmMessages: CoreMessage[] = retrievedContext
    ? [
        {
          role: 'system',
          content: `Relevant context from this athlete's past conversations and session notes (use if helpful, don't force it):\n${retrievedContext}`,
        },
        ...messages.map((m) => ({ role: m.role, content: m.content }) as CoreMessage),
      ]
    : (messages.map((m) => ({ role: m.role, content: m.content })) as CoreMessage[])

  // Stream the agent reply (AI SDK v4 model → streamLegacy).
  let result
  try {
    result = await agent.streamLegacy(llmMessages)
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
          const assistantEmbedding = await embedForStorage(full, aiSettings.userApiKey)
          await admin.from('coaching_messages').insert({
            user_id: user.id,
            role: 'assistant',
            content: full,
            metadata: { kind: 'chat' },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            embedding: assistantEmbedding as any,
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
