-- ============================================================
-- Coach chat sessions + kept history (memories).
--
-- coach_sessions: one row per chat thread. coaching_messages.session_id points at it
--   (ON DELETE CASCADE, so deleting a session removes its messages and their embeddings).
-- coach_memories: one LLM-written summary per deleted session that the athlete chose to keep.
--   Injected into the coach prompt as a system message. Editable and deletable by the athlete.
--   No FK to coach_sessions: the memory outlives the session it came from.
--
-- Backfill: every user with existing kind='chat' messages gets ONE session titled
-- 'Earlier conversation' that owns those messages. Re-running creates nothing new.
--
-- Applied MANUALLY (gotcha #4), NOT auto-run. Idempotent. Apply it on the local stack AND on the
-- prod VM BEFORE deploying code that reads/writes these tables.
--
--   docker exec -i sportai-db psql -U postgres -d postgres < supabase/migrations/018_coach_sessions.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS public.coach_sessions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title       text        NOT NULL DEFAULT 'New chat',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS coach_sessions_user_updated
  ON public.coach_sessions (user_id, updated_at DESC);

ALTER TABLE public.coach_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "coach_sessions: users can view own" ON public.coach_sessions;
CREATE POLICY "coach_sessions: users can view own"
  ON public.coach_sessions FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "coach_sessions: users can insert own" ON public.coach_sessions;
CREATE POLICY "coach_sessions: users can insert own"
  ON public.coach_sessions FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "coach_sessions: users can update own" ON public.coach_sessions;
CREATE POLICY "coach_sessions: users can update own"
  ON public.coach_sessions FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "coach_sessions: users can delete own" ON public.coach_sessions;
CREATE POLICY "coach_sessions: users can delete own"
  ON public.coach_sessions FOR DELETE USING (auth.uid() = user_id);

ALTER TABLE public.coaching_messages
  ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES public.coach_sessions(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS coaching_messages_session_created
  ON public.coaching_messages (session_id, created_at);

CREATE TABLE IF NOT EXISTS public.coach_memories (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title              text        NOT NULL DEFAULT 'Chat summary',
  summary            text        NOT NULL,
  message_count      int,
  source_started_at  timestamptz,
  source_ended_at    timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS coach_memories_user_created
  ON public.coach_memories (user_id, created_at DESC);

ALTER TABLE public.coach_memories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "coach_memories: users can view own" ON public.coach_memories;
CREATE POLICY "coach_memories: users can view own"
  ON public.coach_memories FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "coach_memories: users can insert own" ON public.coach_memories;
CREATE POLICY "coach_memories: users can insert own"
  ON public.coach_memories FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "coach_memories: users can update own" ON public.coach_memories;
CREATE POLICY "coach_memories: users can update own"
  ON public.coach_memories FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "coach_memories: users can delete own" ON public.coach_memories;
CREATE POLICY "coach_memories: users can delete own"
  ON public.coach_memories FOR DELETE USING (auth.uid() = user_id);

-- Backfill: one 'Earlier conversation' session per user with unassigned chat messages.
DO $$
DECLARE
  r RECORD;
  new_id uuid;
BEGIN
  FOR r IN
    SELECT user_id,
           min(created_at) AS first_at,
           max(created_at) AS last_at
    FROM public.coaching_messages
    WHERE session_id IS NULL
      AND metadata->>'kind' = 'chat'
    GROUP BY user_id
  LOOP
    INSERT INTO public.coach_sessions (user_id, title, created_at, updated_at)
    VALUES (r.user_id, 'Earlier conversation', r.first_at, r.last_at)
    RETURNING id INTO new_id;

    UPDATE public.coaching_messages
    SET session_id = new_id
    WHERE user_id = r.user_id
      AND session_id IS NULL
      AND metadata->>'kind' = 'chat';
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
