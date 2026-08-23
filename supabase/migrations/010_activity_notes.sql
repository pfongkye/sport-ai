-- ============================================================
-- Per-session notes (voice-transcribed or typed) — transcript-only.
--
-- Source of truth for notes shown on an activity. A mirrored, embedded copy is
-- also written to coaching_messages (kind='session_voice_note') so RAG has a
-- single place to search all recallable memory. Audio is NOT stored by default
-- (see Task 2.9); audio_url is nullable for a future opt-in.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.activity_notes (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  activity_id   uuid        NOT NULL REFERENCES public.activities(id) ON DELETE CASCADE,
  transcript    text        NOT NULL,
  source        text        NOT NULL DEFAULT 'voice' CHECK (source IN ('voice', 'text')),
  duration_s    integer,                       -- recording length (voice only)
  audio_url     text,                          -- NULL by default; future opt-in
  -- Link back to the mirrored coaching_messages row so we can delete both.
  message_id    uuid        REFERENCES public.coaching_messages(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS activity_notes_activity ON public.activity_notes (activity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS activity_notes_user ON public.activity_notes (user_id, created_at DESC);

ALTER TABLE public.activity_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notes: users can view own" ON public.activity_notes;
CREATE POLICY "notes: users can view own"
  ON public.activity_notes FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "notes: users can insert own" ON public.activity_notes;
CREATE POLICY "notes: users can insert own"
  ON public.activity_notes FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "notes: users can update own" ON public.activity_notes;
CREATE POLICY "notes: users can update own"
  ON public.activity_notes FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "notes: users can delete own" ON public.activity_notes;
CREATE POLICY "notes: users can delete own"
  ON public.activity_notes FOR DELETE USING (auth.uid() = user_id);
