/**
 * Text embeddings for RAG over coaching_messages.
 *
 * Uses OpenAI `text-embedding-3-small` (1536 dims — matches the pgvector column
 * `coaching_messages.embedding vector(1536)`). Embeddings are OpenAI-only here;
 * if no OpenAI key is available we return null and callers skip embedding rather
 * than failing the request (RAG degrades to recent-history only).
 */

const EMBEDDING_MODEL = 'text-embedding-3-small'
const EMBEDDING_DIMS = 1536

function openaiKey(userApiKey?: string | null): string | null {
  return userApiKey || process.env.OPENAI_API_KEY || null
}

/**
 * Embed a single string → number[1536], or null if unavailable/failed.
 * Never throws — embedding is best-effort and must not break chat.
 */
export async function embedText(
  text: string,
  userApiKey?: string | null
): Promise<number[] | null> {
  const key = openaiKey(userApiKey)
  const input = text.trim()
  if (!key || !input) return null

  try {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: input.slice(0, 8000), // safety cap on token length
        dimensions: EMBEDDING_DIMS,
      }),
    })
    if (!res.ok) {
      console.error('[embeddings] failed', res.status, (await res.text()).slice(0, 200))
      return null
    }
    const json = (await res.json()) as { data?: { embedding: number[] }[] }
    return json.data?.[0]?.embedding ?? null
  } catch (err) {
    console.error('[embeddings] request error', err)
    return null
  }
}

/**
 * pgvector accepts a string literal like "[0.1,0.2,...]". supabase-js sends the
 * value as-is over PostgREST, so format the array that way for inserts/RPC.
 */
export function toPgVector(embedding: number[]): string {
  return `[${embedding.join(',')}]`
}
