-- ============================================================
-- Route & itinerary suggestions — home location on profiles + a cache of
-- generated round-trip routes.
--
-- This supports the deterministic ORS routing service (app/src/lib/integrations/
-- ors/). We generate real, runnable round-trip loops of ~N km near a start point
-- (explicit coord / geocoded place / browser geo / profile home / last activity),
-- pick flat vs uphill by computed ascent, and cache the chosen route so re-views
-- don't re-hit ORS.
--
-- Applied MANUALLY (gotcha #4) — this file is NOT auto-run. Idempotent so it can
-- be re-applied safely (IF NOT EXISTS / DROP POLICY IF EXISTS).
-- ============================================================

-- 1) Home location on profiles (athlete data; profiles already has owner RLS so
--    no new policy is needed here). All nullable — the athlete may not set one.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS home_lat    double precision,
  ADD COLUMN IF NOT EXISTS home_lng    double precision,
  ADD COLUMN IF NOT EXISTS home_label  text;

-- 2) Cache of generated routes. One row per chosen route (never a partial row —
--    written only AFTER a valid route is selected). Geometry/elevation/bbox are
--    stored as jsonb (GeoJSON LineString + sampled profile + [minLng,minLat,
--    maxLng,maxLat]).
CREATE TABLE IF NOT EXISTS public.suggested_routes (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Optional link to a plan's long-run session. SET NULL so deleting/archiving a
  -- plan doesn't orphan-error a cached route — the route survives standalone.
  planned_session_id   uuid        REFERENCES public.planned_sessions(id) ON DELETE SET NULL,
  requested_distance_m integer     NOT NULL,
  distance_m           integer     NOT NULL,
  ascent_m             integer     NOT NULL,
  descent_m            integer     NOT NULL,
  terrain              text        NOT NULL CHECK (terrain IN ('flat', 'uphill')),
  start_lat            double precision NOT NULL,
  start_lng            double precision NOT NULL,
  start_label          text,
  geometry             jsonb       NOT NULL,   -- GeoJSON LineString ([lng,lat,ele][])
  elevation_profile    jsonb       NOT NULL,   -- [{distM, eleM}]
  bbox                 jsonb       NOT NULL,   -- [minLng, minLat, maxLng, maxLat]
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.suggested_routes ENABLE ROW LEVEL SECURITY;

-- Owner-scoped RLS (copy the 011_strava.sql pattern): users see/manage ONLY their
-- own routes.
DROP POLICY IF EXISTS "routes: users can view own" ON public.suggested_routes;
CREATE POLICY "routes: users can view own"
  ON public.suggested_routes FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "routes: users can insert own" ON public.suggested_routes;
CREATE POLICY "routes: users can insert own"
  ON public.suggested_routes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "routes: users can update own" ON public.suggested_routes;
CREATE POLICY "routes: users can update own"
  ON public.suggested_routes FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "routes: users can delete own" ON public.suggested_routes;
CREATE POLICY "routes: users can delete own"
  ON public.suggested_routes FOR DELETE
  USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS suggested_routes_updated_at ON public.suggested_routes;
CREATE TRIGGER suggested_routes_updated_at
  BEFORE UPDATE ON public.suggested_routes
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

CREATE INDEX IF NOT EXISTS suggested_routes_user_idx
  ON public.suggested_routes (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS suggested_routes_session_idx
  ON public.suggested_routes (planned_session_id);
