import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { getOwnedChatSession } from './sessions'
import type { TranscriptMessage } from './summarize'

type Client = SupabaseClient<Database>

export type DeleteChatSessionResult =
  | { ok: true; deleted: string; memory: { id: string; title: string } | null }
  | { ok: false; status: 404 | 500 | 502; error: string }

export interface DeleteChatSessionOptions {
  keepHistory: boolean
  /** Only called when keepHistory is true and the session has messages. */
  summarize: (messages: TranscriptMessage[]) => Promise<string>
}

/**
 * Delete a chat session owned by the caller, optionally keeping a summary.
 * Keep: load messages, summarize, insert the coach_memories row, and only THEN delete.
 * A failed summary or insert deletes nothing. No keep: never calls the summarizer;
 * deletes all messages (incl. embeddings) by session_id AND user_id, then the session.
 */
export async function deleteChatSession(
  supabase: Client,
  userId: string,
  sessionId: string,
  { keepHistory, summarize }: DeleteChatSessionOptions
): Promise<DeleteChatSessionResult> {
  const session = await getOwnedChatSession(supabase, userId, sessionId)
  if (!session) return { ok: false, status: 404, error: 'Chat not found.' }

  let memory: { id: string; title: string } | null = null

  if (keepHistory) {
    const { data: rows, error: loadErr } = await supabase
      .from('coaching_messages')
      .select('role, content, created_at')
      .eq('user_id', userId)
      .eq('session_id', sessionId)
      .in('role', ['user', 'assistant'])
      .order('created_at', { ascending: true })
    if (loadErr) return { ok: false, status: 500, error: 'Could not load the chat.' }
    const messages = (rows ?? []) as { role: string; content: string; created_at: string }[]

    if (messages.length > 0) {
      let summary: string
      try {
        summary = await summarize(messages)
      } catch (err) {
        console.error('[chat-sessions] summarize failed', err)
        return { ok: false, status: 502, error: 'Could not summarize the chat. Nothing was deleted.' }
      }
      const { data: inserted, error: insErr } = await supabase
        .from('coach_memories')
        .insert({
          user_id: userId,
          title: session.title,
          summary,
          message_count: messages.length,
          source_started_at: messages[0].created_at,
          source_ended_at: messages[messages.length - 1].created_at,
        })
        .select('id, title')
        .single()
      if (insErr || !inserted) {
        return { ok: false, status: 500, error: 'Could not save the summary. Nothing was deleted.' }
      }
      memory = { id: (inserted as { id: string }).id, title: (inserted as { title: string }).title }
    }
  }

  const { error: msgErr } = await supabase
    .from('coaching_messages')
    .delete()
    .eq('session_id', sessionId)
    .eq('user_id', userId)
  if (msgErr) return { ok: false, status: 500, error: 'Could not delete the chat messages.' }

  const { error: sessErr } = await supabase
    .from('coach_sessions')
    .delete()
    .eq('id', sessionId)
    .eq('user_id', userId)
  if (sessErr) return { ok: false, status: 500, error: 'Could not delete the chat.' }

  return { ok: true, deleted: sessionId, memory }
}
