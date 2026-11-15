-- ============================================================
-- Retention for the suggested_routes cache.
--
-- Cached routes were never deleted. prune_suggested_routes() removes routes older
-- than `retain_days` that are NOT attached to a plan session (planned_session_id
-- IS NULL). Routes linked to a plan session are kept. The app never reuses cached
-- rows as an ORS response cache (it only lists / views them by id), so a TTL
-- refresh is not needed: pruning is enough.
--
-- Returns the number of deleted rows. SECURITY DEFINER with a pinned search_path
-- (see 012_fix_crypto_search_path.sql). EXECUTE is revoked from public, anon and
-- authenticated: run it as the service role / postgres from the SQL editor, or
-- schedule it.
--
-- Applied MANUALLY (gotcha #4) — this file is NOT auto-run. Idempotent
-- (CREATE OR REPLACE + REVOKE can be re-run safely).
--
-- Usage:   SELECT public.prune_suggested_routes();      -- default 90 days
--          SELECT public.prune_suggested_routes(30);
-- ============================================================

CREATE OR REPLACE FUNCTION public.prune_suggested_routes(retain_days integer DEFAULT 90)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  deleted_count integer;
BEGIN
  IF retain_days IS NULL OR retain_days < 1 THEN
    RAISE EXCEPTION 'retain_days must be >= 1';
  END IF;

  DELETE FROM public.suggested_routes
  WHERE planned_session_id IS NULL
    AND created_at < now() - make_interval(days => retain_days);

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.prune_suggested_routes(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prune_suggested_routes(integer) FROM anon;
REVOKE ALL ON FUNCTION public.prune_suggested_routes(integer) FROM authenticated;

-- Optional: schedule daily at 03:30 UTC. pg_cron is NOT enabled by
-- 001_extensions.sql, so this is left commented out. Enable the extension first
-- (self-hosted Supabase: the postgres image must have pg_cron loaded), or just
-- run the SELECT above by hand now and then.
--
-- CREATE EXTENSION IF NOT EXISTS pg_cron;
-- SELECT cron.schedule('prune-suggested-routes', '30 3 * * *',
--                      $$SELECT public.prune_suggested_routes(90)$$);
