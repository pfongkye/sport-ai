-- ============================================================
-- Fix: strava_connections.athlete_id must be NULLABLE
--
-- Symptom (deployed): connecting Strava fails with
--   null value in column "athlete_id" of relation "strava_connections"
--   violates not-null constraint
--
-- Cause: athlete_id was NOT NULL, but it's populated from the OAuth token
-- response's `athlete` block, which Strava does NOT always include (it's absent
-- on refresh and can be absent on the authorization-code exchange too). It's
-- denormalised display data, not an identity key — the row's identity is the PK
-- `user_id`. The app now also falls back to GET /athlete on first connect, but
-- making the column nullable removes the hard-failure mode entirely.
--
-- Idempotent: DROP NOT NULL is a no-op if already nullable.
-- ============================================================

ALTER TABLE public.strava_connections ALTER COLUMN athlete_id DROP NOT NULL;
