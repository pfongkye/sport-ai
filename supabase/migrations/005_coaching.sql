-- ============================================================
-- Coaching Messages — conversation history + RAG embeddings
-- ============================================================

CREATE TABLE public.coaching_messages (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role        text        NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content     text        NOT NULL,
  audio_url   text,
  metadata    jsonb,      -- tool calls, referenced activity_id, session_id, etc.
  embedding   vector(1536),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Standard index for fetching recent history
CREATE INDEX coaching_messages_user_created
  ON public.coaching_messages (user_id, created_at DESC);

-- pgvector index for similarity search (RAG retrieval)
-- Using IVFFlat — good for up to ~1M vectors
CREATE INDEX coaching_messages_embedding
  ON public.coaching_messages
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

ALTER TABLE public.coaching_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "messages: users can view own"
  ON public.coaching_messages FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "messages: users can insert own"
  ON public.coaching_messages FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "messages: users can delete own"
  ON public.coaching_messages FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================
-- RAG search function — hybrid vector + date filter
-- ============================================================

CREATE OR REPLACE FUNCTION public.search_coaching_messages(
  p_user_id     uuid,
  p_embedding   vector(1536),
  p_limit       int     DEFAULT 10,
  p_threshold   float   DEFAULT 0.75,
  p_from_date   timestamptz DEFAULT NULL,
  p_to_date     timestamptz DEFAULT NULL
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
  ORDER BY cm.embedding <=> p_embedding
  LIMIT p_limit;
END;
$$;
