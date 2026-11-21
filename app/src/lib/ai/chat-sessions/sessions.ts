import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

export const DEFAULT_SESSION_TITLE = 'New chat'
export const MAX_TITLE_CHARS = 60
export const SESSION_LIST_LIMIT = 50

export interface ChatSessionRow {
  id: string
  title: string
  created_at: string
  updated_at: string
}

type Client = SupabaseClient<Database>

/** Newest-first list of the caller's sessions (by updated_at). */
export async function listChatSessions(supabase: Client, userId: string): Promise<ChatSessionRow[]> {
  const { data } = await supabase
    .from('coach_sessions')
    .select('id, title, created_at, updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(SESSION_LIST_LIMIT)
  return (data ?? []) as ChatSessionRow[]
}

export async function createChatSession(
  supabase: Client,
  userId: string
): Promise<ChatSessionRow | null> {
  const { data, error } = await supabase
    .from('coach_sessions')
    .insert({ user_id: userId, title: DEFAULT_SESSION_TITLE })
    .select('id, title, created_at, updated_at')
    .single()
  if (error || !data) return null
  return data as ChatSessionRow
}

/** The caller's session with this id, or null (unknown or someone else's). */
export async function getOwnedChatSession(
  supabase: Client,
  userId: string,
  sessionId: string
): Promise<ChatSessionRow | null> {
  const { data } = await supabase
    .from('coach_sessions')
    .select('id, title, created_at, updated_at')
    .eq('id', sessionId)
    .eq('user_id', userId)
    .maybeSingle()
  return (data as ChatSessionRow | null) ?? null
}

/** The caller's most recently updated session, or null. */
export async function getNewestChatSession(
  supabase: Client,
  userId: string
): Promise<ChatSessionRow | null> {
  const { data } = await supabase
    .from('coach_sessions')
    .select('id, title, created_at, updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(1)
  return ((data ?? [])[0] as ChatSessionRow | undefined) ?? null
}

/** Session title from the first user message: whitespace collapsed, capped at 60 chars. */
export function titleFromMessage(content: string): string {
  const t = content.replace(/\s+/g, ' ').trim()
  if (!t) return DEFAULT_SESSION_TITLE
  return t.length > MAX_TITLE_CHARS ? `${t.slice(0, MAX_TITLE_CHARS - 1).trimEnd()}…` : t
}
