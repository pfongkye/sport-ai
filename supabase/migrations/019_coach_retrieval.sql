-- ============================================================
-- Coach retrieval fixes: per-chat recall setting, session-scoped search, HNSW index.
--
-- 1. coach_sessions.recall_other_chats (boolean, default false). Off = a new chat is a clean
--    slate: RAG only searches this chat's messages plus rows with no session (mirrored
--    activity notes). Kept notes in coach_memories still apply. On = search all chats.
-- 2. search_coaching_messages gets a trailing p_session_id uuid DEFAULT NULL.
--      NULL      -> old behavior (all of the user's rows).
--      non-NULL  -> rows with session_id = p_session_id OR session_id IS NULL.
--    The old 6-arg signature is dropped first so PostgREST never sees an ambiguous overload.
--    Still SECURITY DEFINER with search_path public and filtered by cm.user_id = p_user_id, so a
--    foreign session id simply matches nothing. Grants are unchanged from 005 (none explicit).
--    The 0.3 threshold and limit 5 live in app code and are unchanged.
-- 3. The IVFFlat index (built in 005 on an empty table with lists=100, probes=1) is replaced
--    by HNSW (m=16, ef_construction=64, vector_cosine_ops).
--
-- pgvector: the stack is supabase/postgres:17.6.1.136 (docker/docker-compose.yml), assumed to
-- ship pgvector >= 0.8 (HNSW needs >= 0.5). Verify first:
--   SELECT extversion FROM pg_extension WHERE extname = 'vector';
-- HNSW applies the user_id / session filters AFTER the index scan (hnsw.ef_search = 40 candidates),
-- so a user with few rows among many could get fewer results than expected. On pgvector >= 0.8
-- this can be mitigated with SET hnsw.iterative_scan = relaxed_order. It is NOT set here
-- because an unknown setting would make the function fail on older pgvector; add it
-- deliberately once the version is confirmed.
--
-- Applied MANUALLY (gotcha #4), NOT auto-run. Idempotent. Apply on the local stack AND on the
-- prod VM BEFORE deploying code that sends p_session_id or reads recall_other_chats.
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction: apply WITHOUT psql -1 and do not
-- wrap this file in BEGIN/COMMIT. It does not block writes. If the build fails it leaves an
-- INVALID index: run DROP INDEX IF EXISTS coaching_messages_embedding_hnsw; and re-run.
--
--   docker exec -i sportai-db psql -U postgres -d postgres < supabase/migrations/019_coach_retrieval.sql
-- ============================================================

ALTER TABLE public.coach_sessions
  ADD COLUMN IF NOT EXISTS recall_other_chats boolean NOT NULL DEFAULT false;

DROP FUNCTION IF EXISTS public.search_coaching_messages(uuid, vector, int, float, timestamptz, timestamptz);

CREATE OR REPLACE FUNCTION public.search_coaching_messages(
  p_user_id     uuid,
  p_embedding   vector(1536),
  p_limit       int     DEFAULT 10,
  p_threshold   float   DEFAULT 0.75,
  p_from_date   timestamptz DEFAULT NULL,
  p_to_date     timestamptz DEFAULT NULL,
  p_session_id  uuid    DEFAULT NULL
)
RETURNS TABLE (
  id          uuid,
  role        text,
  content     text,
  metadata    jsonb,
  created_at  timestamptz,
  similarity  float
)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    cm.id,
    cm.role,
    cm.content,
    cm.metadata,
    cm.created_at,
    1 - (cm.embedding <=> p_embedding) AS similarity
  FROM public.coaching_messages cm
  WHERE
    cm.user_id = p_user_id
    AND cm.embedding IS NOT NULL
    AND 1 - (cm.embedding <=> p_embedding) > p_threshold
    AND (p_from_date IS NULL OR cm.created_at >= p_from_date)
    AND (p_to_date IS NULL OR cm.created_at <= p_to_date)
    AND (p_session_id IS NULL OR cm.session_id = p_session_id OR cm.session_id IS NULL)
  ORDER BY cm.embedding <=> p_embedding
  LIMIT p_limit;
END;
$$;

CREATE INDEX CONCURRENTLY IF NOT EXISTS coaching_messages_embedding_hnsw
  ON public.coaching_messages USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

DROP INDEX IF EXISTS public.coaching_messages_embedding;

NOTIFY pgrst, 'reload schema';
