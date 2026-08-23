-- ============================================================
-- Activity Notes — subjective per-session notes (voice or typed)
--
-- One-to-many with activities: a session can have many notes, added at any time.
-- Transcript-only by default: voice is transcribed then the audio is discarded
-- (see AGENTS.md voice=transcript-only decision). audio_url is kept NULLABLE for
-- a future opt-in "keep audio" preference.
--
-- Each note also gets a mirrored, embedded copy in coaching_messages
-- (kind='session_voice_note') so RAG retrieval has one place to search.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.activity_notes (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  activity_id  uuid        NOT NULL REFERENCES public.activities(id) ON DELETE CASCADE,
  transcript   text        NOT NULL,
  source       text        NOT NULL DEFAULT 'voice' CHECK (source IN ('voice', 'text')),
  duration_s   integer,                 -- recording length (voice only), nullable
  audio_url    text,                    -- NULL by default; reserved for future opt-in
  embedding    vector(1536),            -- RAG (populated once Task 2.10 lands)
  -- Links this note to its mirrored coaching_messages row, so delete can clean both.
  message_id   uuid        REFERENCES public.coaching_messages(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS activity_notes_activity ON public.activity_notes (activity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS activity_notes_user ON public.activity_notes (user_id, created_at DESC);

ALTER TABLE public.activity_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notes: users can view own" ON public.activity_notes;
CREATE POLICY "notes: users can view own"
  ON public.activity_notes FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "notes: users can insert own" ON public.activity_notes;
CREATE POLICY "notes: users can insert own"
  ON public.activity_notes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "notes: users can update own" ON public.activity_notes;
CREATE POLICY "notes: users can update own"
  ON public.activity_notes FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "notes: users can delete own" ON public.activity_notes;
CREATE POLICY "notes: users can delete own"
  ON public.activity_notes FOR DELETE
  USING (auth.uid() = user_id);
