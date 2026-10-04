-- ============================================================
-- Strava integration — per-user OAuth connection for importing activities.
--
-- This is a DATA integration, NOT a login provider. The athlete connects their
-- Strava account from Settings; we store their OAuth tokens so the app can pull
-- activities on demand (button) or on request ("import my last 3 Strava runs").
--
-- Tokens are SENSITIVE. We never store them in plaintext — they are encrypted
-- with the same pgcrypto helpers used for AI API keys (encrypt_api_key /
-- decrypt_api_key, migration 007), which read the DB-level `app.encryption_key`
-- GUC. Only service_role may decrypt (the app does this server-side).
--
-- Dedup when importing reuses the existing activities UNIQUE (user_id,
-- external_id) constraint with external_id = 'strava_<activity.id>'.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.strava_connections (
  user_id            uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Strava athlete id (bigint in Strava; stored as text to be safe/forward-compatible)
  athlete_id         text        NOT NULL,
  -- OAuth tokens, encrypted at rest (base64 pgp_sym_encrypt output).
  access_token_enc   text        NOT NULL,
  refresh_token_enc  text        NOT NULL,
  -- Unix epoch seconds when the access token expires (Strava `expires_at`).
  expires_at         bigint      NOT NULL,
  -- Space-delimited scopes granted (we need at least activity:read).
  scope              text,
  -- Denormalised athlete display info for the Settings UI (non-sensitive).
  athlete_firstname  text,
  athlete_lastname   text,
  athlete_username   text,
  -- Bookkeeping for incremental sync + UI.
  last_synced_at     timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.strava_connections ENABLE ROW LEVEL SECURITY;

-- Users can see/manage ONLY their own connection. Note: the app reads/writes
-- tokens through the service-role admin client (to decrypt), but we still scope
-- read/delete to the owner so a user can view "connected?" and disconnect via
-- the anon/RLS client.
DROP POLICY IF EXISTS "strava: users can view own" ON public.strava_connections;
CREATE POLICY "strava: users can view own"
  ON public.strava_connections FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "strava: users can insert own" ON public.strava_connections;
CREATE POLICY "strava: users can insert own"
  ON public.strava_connections FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "strava: users can update own" ON public.strava_connections;
CREATE POLICY "strava: users can update own"
  ON public.strava_connections FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "strava: users can delete own" ON public.strava_connections;
CREATE POLICY "strava: users can delete own"
  ON public.strava_connections FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER strava_connections_updated_at
  BEFORE UPDATE ON public.strava_connections
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();
