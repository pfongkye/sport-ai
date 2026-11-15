# Route & Itinerary Suggestions — Implementation Tasks

> ORS round-trip routing → `suggestRoute` service → cached `suggested_routes`.
> Surfaces: standalone `/routes` UI + `suggestRoute` chat tool + plan long-run attachment.
> Mirrors the Strava integration shape (client + sentinel errors + service). Typed tool only,
> no MCP (gotcha #20). Mobile-first throughout. Migration applied manually (gotcha #4).

Requirement references point at `requirements.md` (e.g. Req 1.3). Careful-points and the full
architecture are in `design.md`.

---

## Phase 1 — Data layer

### Task 1.1 — Migration `014_route_suggestions.sql`
- [ ] Add nullable `home_lat` / `home_lng` (double precision) + `home_label` (text) to
      `public.profiles` (Req 2.2). profiles already has owner RLS — no new policy.
- [ ] Create `public.suggested_routes` (Req 3.1–3.3): columns per design (geometry/elevation_profile/
      bbox as jsonb, terrain CHECK in ('flat','uphill'), `planned_session_id` FK
      `ON DELETE SET NULL`), owner-scoped RLS (copy the 011 SELECT/INSERT/UPDATE/DELETE pattern),
      `set_updated_at` trigger, and the two indexes (user+created_at, planned_session_id).
- [ ] Idempotent (`IF NOT EXISTS` / `DROP POLICY IF EXISTS`). This file does nothing until applied
      manually — note that in the task output, don't assume it's live.

### Task 1.2 — Types
- [ ] Update `app/src/types/database.ts`: add `home_lat/home_lng/home_label` to the `profiles` Row/
      Insert/Update and the `Profile` interface; add a `SuggestedRoute` interface + table typing.

---

## Phase 2 — ORS integration (`app/src/lib/integrations/ors/`)

Mirror `lib/integrations/strava/` structure and conventions.

### Task 2.1 — Config + client
- [ ] `ors/config.ts`: read `ORS_BASE_URL` (default `https://api.openrouteservice.org`) +
      `ORS_API_KEY` from `process.env`, server-only. Export a bounded timeout constant.
- [ ] `ors/client.ts`: sentinel consts (`ORS_RATE_LIMITED`, `ORS_UNAUTHORIZED`, `ORS_NO_ROUTE`,
      `ORS_TIMEOUT`, `ORS_UNAVAILABLE`), `classifyOrsError(status, body)`, and:
      - `orsRoundTrip({lng,lat,lengthM,seed,signal})` → POST `/v2/directions/foot-walking/geojson`
        with `options.round_trip` + `elevation:true` + `instructions:false`; returns the parsed
        GeoJSON feature. `AbortController` timeout → `ORS_TIMEOUT`.
      - `orsGeocode(text, signal)` → GET `/geocode/search`; returns `{lng,lat,label}` or null
        (zero/ambiguous = null). Degrades cleanly if a self-hosted ORS lacks geocoding.
- [ ] Key never logged; raw coordinates never logged in plaintext (Req 1.5, 2.4).

### Task 2.2 — Errors
- [ ] `ors/errors.ts`: `orsErrorResponse(err) → {status, message}` for each sentinel (mirror
      `stravaErrorResponse`). `ORS_UNAUTHORIZED` → owner-fixable message ("set ORS key"); add
      `NO_LOCATION` → 422 "ask for a location"; `ORS_NO_ROUTE` → 422 try different distance/start.

### Task 2.3 — Geo helpers (pure, unit-tested)
- [ ] `ors/geo.ts`: `fromGeolocation(pos) → [lng,lat]` (lat-first → lng-first boundary),
      `bboxOf(coords)`, `sampleElevationProfile(coords3d, maxPoints=100) → [{distM,eleM}]`,
      `terrainScore(feature) → ascentM`. All pure.

### Task 2.4 — Suggest service
- [ ] `ors/suggest.ts`: `resolveStart(supabase, userId, opts)` priority chain (explicit coord →
      placeText(geocode) → browserCoord → profile home → latest `activity_streams` latlng first
      point). Throw `NO_LOCATION` sentinel when none resolve (Req 2.1, 4.4).
- [ ] `suggestRoute(supabase, userId, opts)`: resolve start → loop ≤`MAX_SEEDS=3` `orsRoundTrip`
      candidates → select by terrain (flat=min ascent, uphill=max) → normalise to `RouteResult`
      (requested vs actual distance, ascent/descent, bbox, GeoJSON, elevation profile, start label).
- [ ] Persist ONE `suggested_routes` row AFTER a valid route is chosen (never a partial row, Req
      7.1); set `planned_session_id` when attaching. Return `{ ...RouteResult, routeId }`.

---

## Phase 3 — API

### Task 3.1 — Suggest endpoint
- [ ] `POST /api/routes/suggest/route.ts` (`runtime='nodejs'`, bounded `maxDuration`): auth → parse
      `{distanceKm, terrain, coord?/placeText?/browserCoord?, plannedSessionId?}` → `suggestRoute` →
      `{route}`. Map sentinels via `orsErrorResponse` (incl. `NO_LOCATION` → 422). Validate
      plannedSessionId ownership when present.

### Task 3.2 — Read endpoints
- [ ] `GET /api/routes/[id]/route.ts` and `GET /api/routes?plannedSessionId=` — owner-scoped (RLS)
      reads of cached route(s) for the UI / session card.

### Task 3.3 — Home location persistence
- [ ] `PATCH /api/profile/home-location/route.ts` (or extend the existing profile save): persist
      `home_lat/lng/label`, server-validated, RLS-scoped (Req 2.2).

---

## Phase 4 — Chat tool

### Task 4.1 — `suggestRoute` tool in `buildCoachTools`
- [ ] Add to `lib/ai/tools/index.ts`. Schema per design, STRICTLY gotcha #36:
      `distanceKm`/`terrain`/`place` all `.nullable().default(null)` (terrain is a nullable enum),
      NO `.min/.max/.uuid`. Validate/clamp in `execute` (distanceKm 1–60, terrain default 'flat').
- [ ] `execute` resolves location server-side (no browserCoord in chat), calls the SAME
      `suggestRoute` service, returns a concise summary (distance, requestedDistance, terrain,
      ascent, startLabel, short note) — NOT geometry (Req 4.3). On `NO_LOCATION` return
      `{needsLocation:true, message}` (don't throw, Req 4.4).
- [ ] Export it from the `buildCoachTools` return object.

### Task 4.2 — Coach prompt guidance
- [ ] Update `prompts/coach.ts`: use `suggestRoute` for route asks; read back distance/ascent/terrain
      honestly incl. requested-vs-actual; MAY describe terrain qualitatively but MUST NOT invent
      named landmarks the data didn't provide (gotcha #23).

---

## Phase 5 — UI (mobile-first; verify on a phone viewport)

### Task 5.1 — Install MapLibre (in-container)
- [ ] Add `maplibre-gl`. Install in-container + recreate (gotcha #16): `docker exec sportai-app npm
      install maplibre-gl` then `docker compose --env-file .env up -d --build app` (or host
      `npm install` if running on host). Import its CSS.

### Task 5.2 — RouteMap component
- [ ] `components/routes/route-map.tsx`: `maplibre-gl` via `next/dynamic` `ssr:false`. Keyless OSM
      raster-tile style (single swappable config constant). Draw GeoJSON line, `fitBounds` to bbox.
      Bounded-height container (explicit height or it renders 0px). Touch pan/zoom enabled.

### Task 5.3 — ElevationProfile component
- [ ] `components/routes/elevation-profile.tsx`: small SVG/canvas chart from `elevationProfile`
      (no heavy chart dep). Labelled; has a text summary for SR users.

### Task 5.4 — Standalone `/routes` page
- [ ] `app/(app)/routes/page.tsx` + a client `RouteSuggester`: controls (distance, flat/uphill
      segmented, location source: my-location/home/type-a-place), touch-friendly, keyboard-operable,
      no hover-only (gotcha #23). Fetch via `http()` (gotcha #18). `navigator.geolocation` with
      graceful denial → fall back to home/place.
- [ ] Render RouteMap + ElevationProfile + honest text summary (actual vs requested distance,
      ascent, terrain) — the summary doubles as the map's SR alternative (Req 5.4).
- [ ] Mobile-first single-column layout; map in a bounded card so controls/summary stay
      thumb-reachable; no horizontal scroll. Add a nav entry to `/routes`.

### Task 5.5 — Home location editor in Settings
- [ ] Add a home-location editor to the Settings UI (use-my-location or type-a-place → PATCH
      `/api/profile/home-location`). Accessible + mobile-first. Run `npx eslint` on new client
      components (gotcha #28 — set-state-in-effect isn't caught by build).

---

## Phase 6 — Plan integration

### Task 6.1 — Session → route attach
- [ ] Export a reusable route component/summary from this spec for the plan view to import (one-way
      dependency: plan imports route, not vice-versa). The plan's long-run session card adds
      "Add route" (POST `/api/routes/suggest` with `plannedSessionId` + session `target_distance_m`)
      and "View route" (GET cached). Additive only — never edits session targets (Req 6.2, 6.3).
- [ ] NOTE: the session card itself lives in the `training-plan-generation` plan view; this task
      lands only if that plan view exists. If the plan UI isn't built yet, deliver the route
      component + API here and leave a documented hook for the plan spec to wire in. Flag to the user.

---

## Phase 7 — Env / docs

### Task 7.1 — Env + Docker wiring
- [ ] `app/.env.local.example`: add `ORS_API_KEY` (+ commented `ORS_BASE_URL`) under External APIs
      with the signup link. Mirror into `.env.local` locally (don't commit).
- [ ] `docker/docker-compose.yml` `app` service: pass `ORS_API_KEY` / `ORS_BASE_URL` through
      (app-side, NOT `docker/.env`). Recreate not restart (gotcha #8).

### Task 7.2 — README
- [ ] Add a short "Suggested routes (ORS)" setup note + a Troubleshooting entry (missing key →
      `ORS_UNAUTHORIZED` → set `ORS_API_KEY`).

---

## Phase 8 — Verification

### Task 8.1 — Tests
- [ ] Unit: `geo.ts` (fromGeolocation, bbox, elevation sampling), terrain selection (flat=min /
      uphill=max ascent), `classifyOrsError` sentinel mapping (mirror `errors.test.ts`).
- [ ] Unit: `resolveStart` priority chain incl. NO_LOCATION.
- [ ] Unit (tool): `suggestRoute` schema accepts all-omitted (→ all null) args, clamps distance,
      returns `needsLocation` instead of throwing when unresolved (gotcha #36 regression guard).
- [ ] Integration (mocked ORS fetch): happy path writes one normalised `suggested_routes` row;
      `ORS_NO_ROUTE`/timeout writes nothing + surfaces sentinel; attach sets `planned_session_id`.

### Task 8.2 — Build, lint, manual
- [ ] `npm run build` + `npx eslint <new client components>` in-container (gotchas #28, #16).
- [ ] Manual on a phone viewport: 5k flat loop from browser geo → map + elevation + honest summary;
      attach a route to a plan long-run session; confirm the ORS key never appears in the client
      bundle/network (not sent as a query param, not under a `NEXT_PUBLIC_` name).

---

## Follow-ups

- [x] ORS quota logging (`ors/quota.ts`, `[ors-quota]` prefix, `ORS_QUOTA_WARN_PCT`) with unit tests.
- [x] Retention: migration `015_suggested_routes_retention.sql` (`prune_suggested_routes`). No TTL refresh because
      cached rows are only listed / viewed by id, never reused instead of calling ORS.
- [x] Optional ascent backfill: `recomputeAscent` (geo.ts) + `app/scripts/backfill-route-ascent.mjs` (dry run by default).
