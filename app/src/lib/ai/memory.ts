import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { embedText, toPgVector } from './embeddings'

const RETRIEVAL_LIMIT = 5
const SIMILARITY_THRESHOLD = 0.3 // cosine similarity floor (0-1); permissive to start

interface RetrievedSnippet {
  role: string
  content: string
  created_at: string
  similarity: number
}

/**
 * Retrieve the most relevant past coaching messages for a query, via the
 * pgvector hybrid search RPC (search_coaching_messages). Best-effort: returns
 * [] if embeddings are unavailable or the RPC errors — never throws.
 *
 * `admin` should be a service-role client (the RPC is SECURITY DEFINER and we
 * pass p_user_id explicitly, so results stay scoped to the user).
 */
export async function retrieveRelevantContext(
  admin: SupabaseClient<Database>,
  userId: string,
  query: string,
  userApiKey?: string | null
): Promise<string | null> {
  const embedding = await embedText(query, userApiKey)
  if (!embedding) return null

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (admin.rpc as any)('search_coaching_messages', {
      p_user_id: userId,
      p_embedding: toPgVector(embedding),
      p_limit: RETRIEVAL_LIMIT,
      p_threshold: SIMILARITY_THRESHOLD,
    })
    if (error || !data?.length) return null

    const snippets = (data as RetrievedSnippet[])
      .filter((s) => s.content?.trim())
      .map((s) => {
        const when = s.created_at.slice(0, 10)
        const who = s.role === 'user' ? 'Athlete said' : 'You (coach) said'
        return `- [${when}] ${who}: ${s.content.replace(/\s+/g, ' ').slice(0, 300)}`
      })

    if (!snippets.length) return null
    return snippets.join('\n')
  } catch (err) {
    console.error('[memory] retrieval failed', err)
    return null
  }
}

/**
 * Embed a message's content and return the pgvector string for storage, or null.
 * Best-effort — callers store null embedding if this returns null.
 */
export async function embedForStorage(
  content: string,
  userApiKey?: string | null
): Promise<string | null> {
  const embedding = await embedText(content, userApiKey)
  return embedding ? toPgVector(embedding) : null
}
