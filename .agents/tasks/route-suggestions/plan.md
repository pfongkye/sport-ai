# Implementation Plan — Route & Itinerary Suggestions

All work happens in the worktree `/Users/pascal.fongkye/Documents/ws/sportai/.worktrees/route-suggestions`.
Every path below is ABSOLUTE under that worktree. The app lives in `.../route-suggestions/app`
(Next.js 16 App Router, TS, Tailwind 4). The coder runs on the host filesystem (not in Docker).

## Verification bar (applies to every item that touches `app/`)
- `cd /Users/pascal.fongkye/Documents/ws/sportai/.worktrees/route-suggestions/app && npm run build` must pass (runs the TS check).
- `cd .../route-suggestions/app && npm run test` (Vitest) for unit/integration items.
- `cd .../route-suggestions/app && npx eslint <new client components>` — repo eslint flags
  `react-hooks/set-state-in-effect` as an ERROR that `npm run build` does NOT catch (gotcha #28).

## Scope notes (read before starting)
- Phase 6 (plan integration) is SKIPPED except: deliver a reusable route summary/map component and
  leave a documented export hook so the `training-plan-generation` plan spec can wire it in later.
  The `/plan` view is currently a stub (`app/src/app/(app)/plan/page.tsx` — a placeholder, no
  session card exists), so there is nothing to attach to now. This is stated explicitly in item 13.
- Migration `014_route_suggestions.sql` is AUTHORED but NEVER run against any DB — migrations are
  applied manually (gotcha #4). Mirror the RLS/trigger style of `011_strava.sql`.
- Typed Mastra coach tools ONLY, no MCP (gotcha #20).
- Tool schema rule (gotcha #36, most likely silent failure): every model-facing optional field MUST
  be `.nullable().default(null)`, NEVER bare `.optional()`; no `.min/.max/.uuid` on model-supplied
  values; validate/clamp INSIDE `execute`; never throw from a tool (return `{needsLocation:true,…}`).
- ORS key is a SERVER secret: never to the browser, never under a `NEXT_PUBLIC_` name, never logged;
  raw coordinates never logged in plaintext.
- Pipeline is lng-first end to end (ORS, GeoJSON, MapLibre). The only lat-first boundary is
  `navigator.geolocation` → centralize + unit-test `fromGeolocation(pos) → [lng,lat]`.
- The existing `app/src/components/activities/activity-map.tsx` uses react-leaflet — do NOT refactor
  it. The new route map uses `maplibre-gl` per the settled decision ("pick maplibre").

---

- [ ] 1. Author migration `014_route_suggestions.sql`.
      Add nullable `home_lat`/`home_lng` (double precision) + `home_label` (text) to
      `public.profiles` (profiles already has owner RLS; no new policy). Create
      `public.suggested_routes` exactly per design.md §Data (columns incl. `terrain` CHECK in
      ('flat','uphill'), `planned_session_id` uuid REFERENCES `public.planned_sessions(id)`
      ON DELETE SET NULL, geometry/elevation_profile/bbox as jsonb, start_lat/start_lng/start_label),
      owner-scoped SELECT/INSERT/UPDATE/DELETE RLS copied from the `011_strava.sql` pattern,
      a `set_updated_at` trigger, and the two indexes (`(user_id, created_at DESC)`,
      `(planned_session_id)`). Idempotent (`IF NOT EXISTS` / `DROP POLICY IF EXISTS`). Do NOT run it.
      Files: `/Users/pascal.fongkye/Documents/ws/sportai/.worktrees/route-suggestions/supabase/migrations/014_route_suggestions.sql`
      Verify: `psql`-lint by eye is enough; confirm the file parses by running
      `cd .../route-suggestions && grep -c "CREATE POLICY" supabase/migrations/014_route_suggestions.sql`
      returns 4. (No DB apply — gotcha #4. This file is inert until applied manually.)

- [ ] 2. Update hand-maintained DB types.
      In `app/src/types/database.ts`: add `home_lat`/`home_lng` (number|null) and `home_label`
      (string|null) to the `profiles` Row/Insert/Update in `_Database` AND to the exported `Profile`
      interface. Add a `suggested_routes` table typing to `_Database` and a `SuggestedRoute` exported
      interface (fields mirroring the migration columns; geometry/elevation_profile/bbox typed as
      `Json`). `Database` stays `any`.
      Files: `/Users/pascal.fongkye/Documents/ws/sportai/.worktrees/route-suggestions/app/src/types/database.ts`
      Verify: `cd .../route-suggestions/app && npm run build` passes.

- [ ] 3. ORS config + geo helpers (pure, unit-tested first).
      `ors/config.ts`: read `ORS_BASE_URL` (default `https://api.openrouteservice.org`) + `ORS_API_KEY`
      from `process.env` (server-only), export a bounded timeout constant (e.g. `ORS_TIMEOUT_MS = 8000`)
      and `MAX_SEEDS = 3`. `ors/geo.ts` (all pure): `fromGeolocation(pos) → [lng,lat]` (lat-first →
      lng-first boundary), `bboxOf(coords) → [minLng,minLat,maxLng,maxLat]`,
      `sampleElevationProfile(coords3d, maxPoints=100) → [{distM,eleM}]`, `terrainScore(feature) → ascentM`.
      Files: `.../app/src/lib/integrations/ors/config.ts`, `.../app/src/lib/integrations/ors/geo.ts`
      Verify: `cd .../route-suggestions/app && npm run build` passes (geo unit tests added in item 11).

- [ ] 4. ORS HTTP client + sentinel errors.
      `ors/client.ts` mirrors `strava/client.ts`: export sentinel consts `ORS_RATE_LIMITED` (429),
      `ORS_UNAUTHORIZED` (401/403), `ORS_NO_ROUTE` (404/no routable path), `ORS_TIMEOUT`,
      `ORS_UNAVAILABLE` (5xx/network); `classifyOrsError(status, body) → Error | null`;
      `orsRoundTrip({lng,lat,lengthM,seed,signal}) → OrsRouteFeature` (POST
      `{ORS_BASE_URL}/v2/directions/foot-walking/geojson` with `options.round_trip` {length,points:4,seed}
      + `elevation:true` + `instructions:false`, `Authorization: {ORS_API_KEY}` header, AbortController
      deadline → `ORS_TIMEOUT`); `orsGeocode(text, signal) → {lng,lat,label} | null` (GET
      `{ORS_BASE_URL}/geocode/search`, zero/ambiguous → null, degrades cleanly if self-hosted ORS lacks
      geocoding). Key never logged; raw coords never logged plaintext. `ors/errors.ts`:
      `orsErrorResponse(err) → {status, message}` mirroring `stravaErrorResponse` — map each sentinel
      plus `NO_LOCATION` → 422 and `ORS_NO_ROUTE` → 422; `ORS_UNAUTHORIZED` → 500 owner-fixable message.
      Files: `.../app/src/lib/integrations/ors/client.ts`, `.../app/src/lib/integrations/ors/errors.ts`
      Verify: `cd .../route-suggestions/app && npm run build` passes (sentinel-mapping tests in item 11).

- [ ] 5. Suggest service (`resolveStart` + `suggestRoute`).
      `ors/suggest.ts` exporting `Terrain`, `SuggestRouteOptions`, `RouteResult` (per design.md
      §Service), the `NO_LOCATION` sentinel const, `resolveStart(supabase, userId, opts)` (priority
      chain: explicit coord → `placeText` via `orsGeocode` → `browserCoord` → profile
      `home_lat/home_lng/home_label` → most recent `activity_streams` `stream_type='latlng'` first point;
      throw `NO_LOCATION` when none resolve), and `suggestRoute(supabase, userId, opts)` (resolve start
      → loop ≤`MAX_SEEDS` `orsRoundTrip` candidates → select by terrain via `terrainScore` (flat=min
      ascent, uphill=max) → normalise to `RouteResult` with requested-vs-actual distance, ascent/descent,
      bbox, GeoJSON geometry, elevation profile, start label → persist ONE `suggested_routes` row AFTER
      a valid route is chosen (never a partial row), setting `planned_session_id` when attaching →
      return `{...RouteResult, routeId}`). Reuse `@/lib/supabase/server` client types; never instantiate
      a client here (passed in). Bounded timeout + graceful failure; ≤3 ORS calls.
      Files: `.../app/src/lib/integrations/ors/suggest.ts`
      Verify: `cd .../route-suggestions/app && npm run build` passes (service tests in item 11).

- [ ] 6. Suggest API endpoint.
      `POST /api/routes/suggest/route.ts` with `export const runtime = 'nodejs'` and a bounded
      `maxDuration`. Auth via `createClient()` + `supabase.auth.getUser()` (401 if none). Parse body
      `{distanceKm, terrain, coord?/placeText?/browserCoord?, plannedSessionId?}`. When `plannedSessionId`
      present, validate owner (RLS select on `planned_sessions`). Call `suggestRoute` → `{route}`. Map
      sentinels via `orsErrorResponse` (incl. `NO_LOCATION` → 422). Follow the JSON-error shape used by
      `app/src/app/api/integrations/strava/activities/route.ts`.
      Files: `.../app/src/app/api/routes/suggest/route.ts`
      Verify: `cd .../route-suggestions/app && npm run build` passes.

- [ ] 7. Read + home-location API endpoints.
      `GET /api/routes/[id]/route.ts` (owner-scoped single cached route; params typed as
      `Promise<{id:string}>` per Next 16, mirror `api/activities/[id]/route.ts`) and
      `GET /api/routes/route.ts` honoring `?plannedSessionId=` (owner-scoped list, most recent first).
      `PATCH /api/profile/home-location/route.ts`: auth, parse `{home_lat, home_lng, home_label}`,
      server-validate (lat −90..90, lng −180..180, label trimmed/length-capped), update `profiles`
      for `user.id` (RLS-scoped). All `runtime='nodejs'`.
      Files: `.../app/src/app/api/routes/[id]/route.ts`, `.../app/src/app/api/routes/route.ts`,
      `.../app/src/app/api/profile/home-location/route.ts`
      Verify: `cd .../route-suggestions/app && npm run build` passes.

- [ ] 8. `suggestRoute` coach tool.
      Add to `buildCoachTools` in `app/src/lib/ai/tools/index.ts`. `inputSchema`:
      `distanceKm: z.number().nullable().default(null)`, `terrain: z.enum(['flat','uphill']).nullable().default(null)`,
      `place: z.string().nullable().default(null)` — NO `.min/.max/.uuid` (gotcha #36). `execute`
      clamps distanceKm (1–60), defaults terrain to 'flat', resolves location server-side (no
      browserCoord in chat), calls the SAME `suggestRoute` service, returns a CONCISE summary
      `{distance, requestedDistance, terrain, ascent, startLabel, note}` — NOT geometry. On `NO_LOCATION`
      return `{needsLocation:true, message}` (never throw). Export it from the return object. Also update
      `app/src/lib/ai/tools/index.test.ts` `EXPECTED_TOOLS` to include `suggestRoute`.
      Files: `.../app/src/lib/ai/tools/index.ts`, `.../app/src/lib/ai/tools/index.test.ts`
      Verify: `cd .../route-suggestions/app && npm run test` — the wiring guard + new tool tests pass.

- [ ] 9. Coach prompt guidance.
      Update `app/src/lib/ai/prompts/coach.ts` (confirmed path): add `suggestRoute` to the Tool Usage
      Guidelines list and a short "Suggesting routes" section — use `suggestRoute` for route asks; read
      back distance/ascent/terrain honestly INCLUDING requested-vs-actual; MAY describe terrain
      qualitatively but MUST NOT invent named landmarks the data didn't provide; if the tool returns
      `needsLocation`, ask the athlete where they want to run.
      Files: `.../app/src/lib/ai/prompts/coach.ts`
      Verify: `cd .../route-suggestions/app && npm run build` passes.

- [ ] 10. Install maplibre-gl + RouteMap and ElevationProfile components.
      Install on host: `cd .../route-suggestions/app && npm install maplibre-gl` (and
      `npm install -D @types/... ` only if MapLibre ships no bundled types — it ships its own, so no
      @types needed). `components/routes/route-map.tsx`: `'use client'`, loaded by callers via
      `next/dynamic` `ssr:false` (it touches window/WebGL); import `maplibre-gl/dist/maplibre-gl.css`;
      keyless OSM raster-tile style built inline from a SINGLE swappable config constant (NOT the ORS
      key); draw the GeoJSON LineString as a line layer; `fitBounds` to bbox; bounded-height container
      (explicit height or it renders 0px); touch pan/zoom enabled. `components/routes/elevation-profile.tsx`:
      small inline SVG chart from `elevationProfile` (no heavy chart dep), labelled, with an SR text
      summary. No hover-only controls (gotcha #23).
      Files: `.../app/package.json` (+ lockfile), `.../app/src/components/routes/route-map.tsx`,
      `.../app/src/components/routes/elevation-profile.tsx`
      Verify: `cd .../route-suggestions/app && npm run build` passes AND
      `npx eslint src/components/routes/route-map.tsx src/components/routes/elevation-profile.tsx` is clean.

- [ ] 11. Tests for the service, client, geo, and tool.
      Match the existing Vitest style (`splits.test.ts`, `errors.test.ts`, `tools/index.test.ts`;
      stubbed Supabase client, offline). Cover: `geo.ts` (`fromGeolocation`, `bboxOf`,
      `sampleElevationProfile`); terrain selection (given N candidate ascents, flat picks min / uphill
      picks max); `classifyOrsError` sentinel mapping + `orsErrorResponse` status/message
      (mirror `errors.test.ts`); `resolveStart` priority chain including the `NO_LOCATION` path;
      tool `suggestRoute` schema accepts all-omitted args (→ all null), clamps distance, returns
      `needsLocation` instead of throwing when unresolved (gotcha #36 regression guard); integration
      with mocked ORS `fetch` — happy path writes ONE normalised `suggested_routes` row,
      `ORS_NO_ROUTE`/timeout writes nothing and surfaces the sentinel, attach sets `planned_session_id`.
      Files: `.../app/src/lib/integrations/ors/geo.test.ts`, `.../app/src/lib/integrations/ors/errors.test.ts`,
      `.../app/src/lib/integrations/ors/suggest.test.ts`, and tool assertions in
      `.../app/src/lib/ai/tools/index.test.ts`
      Verify: `cd .../route-suggestions/app && npm run test` — all new tests pass.

- [ ] 12. Standalone `/routes` page + RouteSuggester + nav entry.
      `app/src/app/(app)/routes/page.tsx` (server shell, metadata) rendering a client `RouteSuggester`
      (`components/routes/route-suggester.tsx`). Controls: distance (number/slider), flat vs uphill
      (segmented), location source (use-my-location via `navigator.geolocation` → `fromGeolocation`,
      home, type-a-place) — touch-friendly, labelled, keyboard-operable, no hover-only (gotcha #23).
      Fetch `POST /api/routes/suggest` via `http()` (gotcha #18). Render dynamically-imported RouteMap
      (`ssr:false`) + ElevationProfile + an honest text summary (actual vs requested distance, ascent,
      terrain) that doubles as the map's SR alternative. Graceful geolocation denial → fall back to
      home/place. Mobile-first single column, map in a bounded card, no horizontal scroll. Add a
      `/routes` nav entry to both `components/layout/sidebar.tsx` and `components/layout/mobile-nav.tsx`.
      Avoid synchronous `setState` in `useEffect` (derive in `useState(() => …)` or set in a `.then`,
      per the `strava-settings.tsx` pattern).
      Files: `.../app/src/app/(app)/routes/page.tsx`, `.../app/src/components/routes/route-suggester.tsx`,
      `.../app/src/components/layout/sidebar.tsx`, `.../app/src/components/layout/mobile-nav.tsx`
      Verify: `cd .../route-suggestions/app && npm run build` passes AND
      `npx eslint src/app/\(app\)/routes/page.tsx src/components/routes/route-suggester.tsx` is clean.

- [ ] 13. Home-location editor in Settings + documented plan export hook.
      Add a home-location editor client component (`components/routes/home-location-editor.tsx`):
      use-my-location (`navigator.geolocation`→`fromGeolocation`) or type-a-place → `PATCH
      /api/profile/home-location` via `http()`; accessible + mobile-first, no hover-only controls.
      Wire it into `app/src/app/(app)/settings/page.tsx` (server-load current `home_lat/home_lng/home_label`
      from `profiles` and pass as props, mirroring how `StravaSettings` receives `initialConnection`).
      PLAN EXPORT HOOK (Phase 6 is otherwise SKIPPED): export the reusable `RouteMap`, `ElevationProfile`,
      and a small `RouteSummary` presentational component from a single barrel
      `components/routes/index.ts`, and add a top-of-file doc comment in that barrel stating that the
      `training-plan-generation` plan view imports these (one-way: plan → route) and attaches a route to
      a long-run session via `POST /api/routes/suggest` with `plannedSessionId` + the session's
      `target_distance_m`. The `/plan` view is a stub today (`app/src/app/(app)/plan/page.tsx`) with no
      session card, so NOTHING is wired here now — this is the documented leave-behind only.
      Files: `.../app/src/components/routes/home-location-editor.tsx`, `.../app/src/components/routes/index.ts`,
      `.../app/src/components/routes/route-summary.tsx`, `.../app/src/app/(app)/settings/page.tsx`
      Verify: `cd .../route-suggestions/app && npm run build` passes AND
      `npx eslint src/components/routes/home-location-editor.tsx` is clean.

- [ ] 14. Env + Docker + README wiring (Phase 7).
      `app/.env.local.example`: under "External APIs" add `ORS_API_KEY=your-openrouteservice-api-key`
      and a commented `# ORS_BASE_URL=https://api.openrouteservice.org` with the signup link
      `https://openrouteservice.org/dev/#/signup`. `docker/docker-compose.yml` `app` service
      `environment:` block: add explicit pass-through `ORS_API_KEY: ${ORS_API_KEY}` and
      `ORS_BASE_URL: ${ORS_BASE_URL:-https://api.openrouteservice.org}` (app-side vars, NOT GoTrue's
      `docker/.env`; the service already loads `../app/.env.local` via `env_file`, so the explicit
      entries just make it discoverable — do NOT touch any running container). README: add a short
      "Suggested routes (ORS)" setup note (get a key, set `ORS_API_KEY`; note the in-container install
      caveat gotcha #16 for Docker) + a Troubleshooting entry (missing key → `ORS_UNAUTHORIZED` → set
      `ORS_API_KEY`).
      Files: `.../app/.env.local.example`, `.../docker/docker-compose.yml`, `.../README.md`
      Verify: `cd .../route-suggestions && grep -n "ORS_API_KEY" app/.env.local.example docker/docker-compose.yml README.md`
      shows the key wired in all three; `cd app && npm run build` still passes.

- [ ] 15. Full integration verification + AGENTS.md note.
      Run the whole suite and build from a clean state, fixing any seams between the items above.
      Confirm the ORS key never appears under a `NEXT_PUBLIC_` name or as a query param. If any
      non-obvious failure or undocumented setup step was hit, append it to the root `AGENTS.md`
      (symptom → cause → fix, numbered) per the repo's living-memory directive.
      Files: `/Users/pascal.fongkye/Documents/ws/sportai/.worktrees/route-suggestions/AGENTS.md` (only if a lesson was learned)
      Verify: `cd .../route-suggestions/app && npm run build && npm run test` both pass; and
      `grep -rn "NEXT_PUBLIC_ORS\|ORS_API_KEY" src | grep -v "process.env.ORS_API_KEY"` finds no
      browser-exposed key.

---

## Open assumptions (reasonable defaults taken; flag if wrong)
- MapLibre tile style: a keyless OSM raster style built inline (per design.md), respecting OSM tile
  usage policy, kept behind one swappable config constant. No paid/keyed tile provider in v1.
- `maxDuration` for `POST /api/routes/suggest` set to a bounded value (e.g. 30s) to cover ≤3 ORS
  round-trips plus optional geocoding within the ORS timeout budget.
- Distance clamp 1–60 km (matches the design's example); terrain default `flat`.
