import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

export const MAX_MEMORY_SUMMARY_CHARS = 2000
export const MAX_MEMORY_TITLE_CHARS = 120

export interface CoachMemoryRow {
  id: string
  title: string
  summary: string
  message_count: number | null
  source_started_at: string | null
  source_ended_at: string | null
  created_at: string
  updated_at: string
}

export interface FormatMemoriesOptions {
  maxItems?: number
  maxCharsEach?: number
  maxTotal?: number
}

/**
 * Format kept summaries for the coach prompt (newest first in, newest first out).
 * Bounded: at most maxItems entries, each cut to maxCharsEach, total capped at maxTotal.
 * Returns '' when there is nothing to inject.
 */
export function formatCoachMemories(
  memories: Pick<CoachMemoryRow, 'title' | 'summary' | 'created_at'>[],
  { maxItems = 5, maxCharsEach = 1200, maxTotal = 3000 }: FormatMemoriesOptions = {}
): string {
  const lines: string[] = []
  let total = 0
  for (const m of memories.slice(0, maxItems)) {
    const summary = m.summary.trim()
    if (!summary) continue
    const body = summary.length > maxCharsEach ? `${summary.slice(0, maxCharsEach)}…` : summary
    const date = m.created_at ? m.created_at.slice(0, 10) : ''
    const line = `- ${m.title}${date ? ` (${date})` : ''}: ${body}`
    if (total + line.length > maxTotal) {
      const room = maxTotal - total
      if (room > 40) lines.push(`${line.slice(0, room - 1)}…`)
      break
    }
    lines.push(line)
    total += line.length + 1
  }
  if (!lines.length) return ''
  return `Notes the athlete chose to keep from earlier, deleted chats (durable facts, use if helpful):\n${lines.join('\n')}`
}

const COLS = 'id, title, summary, message_count, source_started_at, source_ended_at, created_at, updated_at'

export async function listCoachMemories(
  supabase: SupabaseClient<Database>,
  userId: string,
  limit = 50
): Promise<CoachMemoryRow[]> {
  const { data } = await supabase
    .from('coach_memories')
    .select(COLS)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)
  return (data ?? []) as CoachMemoryRow[]
}
