-- ============================================================
-- coaching_messages.metadata.kind convention
--
-- Every coaching_messages row should carry metadata.kind to disambiguate
-- which surface it belongs to:
--   'chat'                 — the AI coach conversation (/coach)
--   'post_session_insight' — per-activity analysis (also has activity_id)
--   (future: 'nutrition_insight', 'weekly_summary', ...)
--
-- This backfills any pre-existing rows that predate the convention. Idempotent:
-- rows that already have a kind are left untouched. Safe to re-run.
-- ============================================================

UPDATE public.coaching_messages
SET metadata = COALESCE(metadata, '{}'::jsonb) || '{"kind":"chat"}'::jsonb
WHERE metadata IS NULL
   OR metadata->>'kind' IS NULL;

-- Helpful index for filtering chat vs other kinds
CREATE INDEX IF NOT EXISTS coaching_messages_user_kind
  ON public.coaching_messages (user_id, ((metadata->>'kind')));
