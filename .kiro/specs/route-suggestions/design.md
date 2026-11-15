# Route & Itinerary Suggestions — Design

## Goal

Generate real, runnable **round-trip routes** of approximately N km near a location, with a map, an
elevation profile, and a `flat`/`uphill` terrain label — via a deterministic server service that
calls OpenRouteService (ORS). Surface it in two places: a standalone route UI + a `suggestRoute`
chat tool, and as an optional attachment to a plan's long-run session. Reuse existing patterns:
the Strava client's sentinel-error shape, the migration/RLS style, the typed-tool conventions
(gotcha #36), and the app-side env wiring.

This spec owns the **geo layer only**. The planning brain (fatigue/programme/goals → dated
sessions) stays in `training-plan-generation` (deterministic workflow). No new free-roaming agent
(settled decision; gotcha #20 — typed tools only, no MCP in the app runtime).

---

## Grounding (existing code)

- **Integration pattern**: `app/src/lib/integrations/strava/` — `client.ts` (thin HTTP client with
  sentinel errors + `classify*Error`), `errors.ts` (`*ErrorResponse(err)` → `{status, message}`),
  `sync.ts` (service orchestration). The ORS integration mirrors this exactly under
  `app/src/lib/integrations/ors/`.
- **Typed tools**: `buildCoachTools(supabase, userId, admin?)` in `lib/ai/tools/index.ts`. New
  `suggestRoute` tool slots in here. MUST follow gotcha #36 schema rules (nullable+default, no
  strict refinements on model inputs, validate in `execute`).
- **Migration/RLS style**: `supabase/migrations/011_strava.sql` — owner-scoped RLS, `set_updated_at`
  trigger, applied manually (gotcha #4). New migration `014_route_suggestions.sql`.
- **Env wiring**: app-side secrets live in `app/.env.local` (e.g. `STRAVA_CLIENT_SECRET`,
  `USDA_API_KEY`), server-read only — NOT `docker/.env` (that's GoTrue). ORS keys follow suit.
- **Profiles**: `profiles` table (migration 002) holds athlete data (`training_days`, `sport_prefs`,
  `primary_goal`). Home location belongs here as athlete data (not `user_settings`, which is app
  config: provider/model/units/timezone).
- **Activity GPS**: `activity_streams` with `stream_type='latlng'` already stores route geometry of
  past activities — the fallback start-point source.
- **Mobile-first / touch**: gotcha #23 (no hover-only interactive controls on touch). The map and
  controls honour this.

---

## Architecture

```
Standalone:  /routes UI  OR  chat suggestRoute tool  OR  POST /api/routes/suggest
Plan:        long-run session "add route" action      → POST /api/routes/suggest (planned_session_id)
   │
   ▼
suggestRoute(supabase, userId, opts)              ← lib/integrations/ors/suggest.ts  (service)
   │  1. resolve start coordinate (deterministic):
   │       explicit coord/place → browser geo → profile home → latest activity latlng start
   │  2. generate candidates (bounded, ≤3 seeds):
   │       ORS Directions round-trip (foot-walking, elevation=true) per seed
   │  3. score + select by terrain preference:
   │       flat → min total ascent;  uphill → max total ascent
   │  4. normalise → { geometry(GeoJSON), distanceM, ascentM, descentM, terrain, bbox,
   │                   requestedDistanceM, elevationProfile[] }
   │  5. persist to suggested_routes (cache; optional planned_session_id link)
   ▼
RouteSummary (+ routeId)  → UI map/elevation  OR  chat read-back  OR  attached to session
```

**Design choice — deterministic, not agentic.** Coordinate resolution, seed generation, and
terrain scoring are plain TypeScript. The LLM is only involved when the coach *narrates* a route it
received from the tool (qualitative "rolling, net uphill early"), never to compute geometry. This
keeps output valid, cheap, and testable — same stance as the plan workflow.

**Design choice — flat/uphill via seed sampling.** ORS round-trip accepts a `seed` that varies the
loop. We request up to 3 seeds, read each route's `ascent` from the ORS elevation summary, and pick
min (flat) or max (uphill). Best-effort: neither exact distance nor exact grade is guaranteed
(Req 1.3). We always return `requestedDistanceM` alongside `distanceM` so the UI/coach is honest.

---

## OpenRouteService specifics

- **Endpoint**: `POST {ORS_BASE_URL}/v2/directions/foot-walking/geojson` (default
  `ORS_BASE_URL=https://api.openrouteservice.org`). `Authorization: {ORS_API_KEY}` header.
- **Round-trip body**:
  ```json
  {
    "coordinates": [[lng, lat]],
    "options": { "round_trip": { "length": <meters>, "points": 4, "seed": <n> } },
    "elevation": true,
    "instructions": false
  }
  ```
  Note ORS uses **[lng, lat]** order. `elevation: true` makes geometry 3D and populates
  `properties.summary.ascent` / `.descent` and `properties.ascent`/`descent`.
- **Geocoding (optional, Req 2.3)**: `GET {ORS_BASE_URL}/geocode/search?text=<place>` →
  `features[0].geometry.coordinates`. If zero/ambiguous results, return a "please confirm location"
  result rather than guessing. Geocoding is best-effort; if `ORS_BASE_URL` points at a self-hosted
  ORS without the geocode module, the service degrades to requiring a coordinate.
- **Elevation profile (Req 1.2 / 5.1)**: derived by sampling the 3D geometry's z-values at a bounded
  number of points (e.g. ≤100) → `[{distM, eleM}]` for the UI chart. No extra API call.

---

## Client: `lib/integrations/ors/client.ts`

Mirrors the Strava client shape.

```ts
export const ORS_RATE_LIMITED   = 'ORS_RATE_LIMITED'   // 429
export const ORS_UNAUTHORIZED   = 'ORS_UNAUTHORIZED'   // 401/403 (bad/forbidden key)
export const ORS_NO_ROUTE       = 'ORS_NO_ROUTE'       // 404/2010 no routable path
export const ORS_TIMEOUT        = 'ORS_TIMEOUT'        // AbortController fired
export const ORS_UNAVAILABLE    = 'ORS_UNAVAILABLE'    // 5xx / network

function classifyOrsError(status: number, body: string): Error | null { ... }

export async function orsRoundTrip(opts: {
  lng: number; lat: number; lengthM: number; seed: number; signal?: AbortSignal
}): Promise<OrsRouteFeature>            // one ORS call

export async function orsGeocode(text: string, signal?: AbortSignal):
  Promise<{ lng: number; lat: number; label: string } | null>
```

- **Timeout**: `AbortController` with a bounded deadline (e.g. 8s) per ORS call → `ORS_TIMEOUT`.
- **Key safety (Req 1.5)**: `ORS_API_KEY` read via `process.env` server-side only. Never returned to
  the browser; never logged. Raw coordinates are not logged in plaintext (Req 2.4) — log only
  coarse/rounded or omit.
- **Config (Req 1.7)**: `ORS_BASE_URL` (default public) + `ORS_API_KEY`, read once in a small
  `config.ts`. Endpoint-configurable so a self-hosted ORS container is a pure env swap.

## Errors: `lib/integrations/ors/errors.ts`

`orsErrorResponse(err) → { status, message }` mapping each sentinel to an actionable message
(mirrors `stravaErrorResponse`). E.g. `ORS_NO_ROUTE` → 422 "Couldn't find a runnable loop there —
try a different distance or start point."; `ORS_RATE_LIMITED` → 429 "Routing is busy, try again in
a minute."; `ORS_UNAUTHORIZED` → 500 "Routing isn't configured — the app owner needs to set the ORS
key." (owner-fixable, like the Strava athlete-limit message).

## Service: `lib/integrations/ors/suggest.ts`

```ts
export type Terrain = 'flat' | 'uphill'

export interface SuggestRouteOptions {
  distanceKm: number
  terrain: Terrain
  // location resolution inputs (first non-null wins, in resolveStart order)
  coord?: { lng: number; lat: number } | null
  placeText?: string | null          // geocoded if provided
  browserCoord?: { lng: number; lat: number } | null
  plannedSessionId?: string | null   // link + cache when attaching to a plan session
}

export interface RouteResult {
  routeId: string
  requestedDistanceM: number
  distanceM: number
  ascentM: number
  descentM: number
  terrain: Terrain
  bbox: [number, number, number, number]
  geometry: GeoJSON.LineString           // [lng,lat,ele][]
  elevationProfile: { distM: number; eleM: number }[]
  start: { lng: number; lat: number; label: string | null }
}

export async function suggestRoute(
  supabase: SupabaseClient<Database>, userId: string, opts: SuggestRouteOptions
): Promise<RouteResult>   // throws a NO_LOCATION sentinel the caller maps to "ask for a location"
```

- `resolveStart(...)` encapsulates the priority chain (Req 2.1). The latest-activity fallback reads
  the most recent `activity_streams` `latlng` first point for `userId` (RLS-scoped).
- Candidate loop capped at `MAX_SEEDS = 3` (Req 7.2); on the first seed's `ORS_NO_ROUTE` with a very
  short/long distance, fail fast with a clear message.
- Persistence is best-effort and happens AFTER a valid route is chosen (Req 7.1 — never write a
  partial row). On attach, set `planned_session_id`.

---

## Data: migration `014_route_suggestions.sql`

Two changes, owner-scoped RLS, `set_updated_at` trigger, applied manually (gotcha #4).

1. **Home location on `profiles`** (Req 2.2) — nullable:
   ```sql
   ALTER TABLE public.profiles
     ADD COLUMN IF NOT EXISTS home_lat    double precision,
     ADD COLUMN IF NOT EXISTS home_lng    double precision,
     ADD COLUMN IF NOT EXISTS home_label  text;
   ```
   (profiles already has owner RLS; no new policy needed. Update `types/database.ts` Profile.)

2. **`suggested_routes` cache** (Req 3.1–3.3):
   ```sql
   CREATE TABLE IF NOT EXISTS public.suggested_routes (
     id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
     planned_session_id  uuid REFERENCES public.planned_sessions(id) ON DELETE SET NULL,
     requested_distance_m integer NOT NULL,
     distance_m          integer NOT NULL,
     ascent_m            integer NOT NULL,
     descent_m           integer NOT NULL,
     terrain             text    NOT NULL CHECK (terrain IN ('flat','uphill')),
     start_lat           double precision NOT NULL,
     start_lng           double precision NOT NULL,
     start_label         text,
     geometry            jsonb   NOT NULL,   -- GeoJSON LineString
     elevation_profile   jsonb   NOT NULL,   -- [{distM,eleM}]
     bbox                jsonb   NOT NULL,
     created_at          timestamptz NOT NULL DEFAULT now(),
     updated_at          timestamptz NOT NULL DEFAULT now()
   );
   ALTER TABLE public.suggested_routes ENABLE ROW LEVEL SECURITY;
   -- owner-scoped SELECT/INSERT/UPDATE/DELETE policies (copy 011 pattern)
   CREATE INDEX IF NOT EXISTS suggested_routes_user_idx    ON public.suggested_routes(user_id, created_at DESC);
   CREATE INDEX IF NOT EXISTS suggested_routes_session_idx ON public.suggested_routes(planned_session_id);
   ```
   Note: `ON DELETE SET NULL` for the session link so deleting/archiving a plan doesn't orphan-error
   a cached route; the route survives as a standalone suggestion.

---

## API routes

- **`POST /api/routes/suggest`** (`runtime='nodejs'`, bounded `maxDuration`): auth → parse body
  `{ distanceKm, terrain, coord?/placeText?/browserCoord?, plannedSessionId? }` → `suggestRoute` →
  `{ route }`. Maps sentinels via `orsErrorResponse`. The `NO_LOCATION` case → 422 with a message
  telling the client to collect a location.
- **`GET /api/routes?plannedSessionId=` / `GET /api/routes/[id]`**: read cached route(s) for the
  owner (RLS) for the UI / session card.
- **`PATCH /api/profile/home-location`** (or extend the existing settings/profile save): persist
  `home_lat/lng/label` from the Settings editor. Server-validated, RLS-scoped.

Middleware already lets `/api/*` self-authorize and return JSON (gotcha #15) — no redirect.

---

## Chat tool: `suggestRoute` in `buildCoachTools`

Follows gotcha #36 strictly (this is the thing most likely to silently break a turn).

```ts
inputSchema: z.object({
  distanceKm: z.number().nullable().default(null)
    .describe('Target loop distance in km; null → ask the athlete or infer from context'),
  terrain: z.enum(['flat','uphill']).nullable().default(null)
    .describe('Preferred terrain; null → default flat'),
  place: z.string().nullable().default(null)
    .describe('A named start location (e.g. "Hyde Park"); null → use home/last location'),
})
```

- NO `.min/.max`, NO `.uuid`, every optional field is `.nullable().default(null)` (never bare
  `.optional()`) — omitting a field under strict function-calling would otherwise read as
  `undefined` → `AI_InvalidToolArgumentsError` → silent dead turn (gotcha #36).
- `execute` clamps `distanceKm` (e.g. 1–60), defaults terrain to `flat`, resolves location
  server-side, calls the SAME `suggestRoute` service, and returns a **concise summary** (Req 4.3):
  `{ distance, requestedDistance, terrain, ascent, startLabel, note }` — NOT raw geometry. On
  `NO_LOCATION`, returns `{ needsLocation: true, message: 'Ask the athlete where they want to run.' }`
  (Req 4.4) rather than throwing. The browser coord is NOT available inside a chat tool, so the chat
  path relies on place/home/last-activity; the UI path can pass `browserCoord`.
- Coach prompt (`prompts/coach.ts`) gains guidance: use `suggestRoute` for route asks; read back
  distance/ascent/terrain honestly; you MAY describe terrain qualitatively but MUST NOT invent named
  landmarks the data didn't provide (gotcha #23). A plan card for the route is gated on the
  chat-interactive-tool-ui data-stream spec; prose summary is the v1 fallback.

---

## UI

### Map rendering (Req 5.3)
- **MapLibre GL JS** (chosen over Leaflet — better touch/gesture handling and vector tiles, which
  matters for the mobile-first target). `maplibre-gl` client component, loaded dynamically
  (`next/dynamic`, `ssr:false`) — it touches `window`/WebGL and must not render on the server. Draw
  the server-returned GeoJSON LineString as a line layer (`addSource` + `addLayer`); fit to `bbox`.
- **Tiles do NOT use the ORS key.** MapLibre needs a style. Use a keyless, OSM-compatible source
  respecting its usage policy — either a free hosted vector style/tiles or a raster-tile style built
  inline from OSM raster tiles (a minimal `{version:8, sources:{osm:{type:'raster',tiles:[...]}}}`
  style works with no provider key and is the safe default). The ORS key stays server-side (Req
  1.5). Pin and document the exact tile source during implementation, and keep it swappable via a
  single config constant so a self-hosted/paid tile source is a one-line change.
- **WebGL note**: `maplibre-gl` ships CSS that must be imported, and needs the canvas container to
  have an explicit height or the map renders 0px — set a bounded height on the map card (also serves
  the mobile-first "don't eat the whole screen" rule).
- **Elevation profile**: a small SVG/canvas chart from `elevationProfile` (no heavy chart dep).

### Standalone `/routes` surface (Req 5.1, 5.2, mobile-first 7.0/5.5)
- Controls: distance (number/slider), flat vs uphill (segmented control), location source (use my
  location [browser geo] / home / type a place). All touch-friendly, labelled, keyboard-operable,
  no hover-only affordances.
- Result: map + elevation profile + an **honest text summary** (actual vs requested distance,
  ascent, terrain) that doubles as the screen-reader alternative for the map canvas (Req 5.4).
- **Mobile-first layout**: single column; map takes a bounded-height card (not full-bleed so the
  summary/controls stay reachable with one thumb); no horizontal scroll; map supports touch
  pan/zoom. Verify on a narrow viewport before done.
- Client fetches use `http()` (gotcha #18) so ngrok dev testing works; browser geo via
  `navigator.geolocation` with graceful denial handling → fall back to home/place.

### Plan integration (Req 6)
- The long-run session card (in the `training-plan-generation` plan view) gets an "Add route" /
  "View route" affordance. "Add route" calls `POST /api/routes/suggest` with `plannedSessionId` and
  the session's `target_distance_m`; "View route" reads the cached route. Additive only — never
  edits the session's targets (Req 6.2). Reuses the SAME service (Req 6.3).
- This card lives in the plan spec's UI; this spec provides the route service, API, map component,
  and the session→route link. Keep the dependency one-way (plan view imports the route component).

---

## Env / Docker / README wiring (Req 7.3)

- `app/.env.local.example`: add an "External APIs" entry:
  ```
  # OpenRouteService — routing for suggested running routes.
  # Free key: https://openrouteservice.org/dev/#/signup  (hosted free tier).
  # ORS_BASE_URL defaults to the public API; point it at a self-hosted ORS to avoid rate limits.
  ORS_API_KEY=your-openrouteservice-api-key
  # ORS_BASE_URL=https://api.openrouteservice.org
  ```
- `docker/docker-compose.yml` `app` service `environment`: pass `ORS_API_KEY` / `ORS_BASE_URL`
  through (they're app-side, like the AI/Strava keys — NOT GoTrue's `docker/.env`). Remember gotcha
  #8 (recreate, not restart) and #16 (new deps installed in-container) when wiring.
- README: a short "Suggested routes (ORS)" setup note + a Troubleshooting entry for a missing key
  (`ORS_UNAUTHORIZED` → "set ORS_API_KEY").

---

## Things to be careful of

1. **[lng, lat] order** — ORS and GeoJSON geometry are both lng-first, and MapLibre's `LngLat`,
   `setCenter`, and `fitBounds` are all lng-lat too — so the whole pipeline (ORS → GeoJSON →
   MapLibre) is consistently lng-first. The trap is `navigator.geolocation`, which returns
   `{latitude, longitude}` (lat-first) — convert it to `[lng, lat]` at the boundary. Centralise a
   `fromGeolocation(pos) → [lng,lat]` helper and unit-test it. (Picking MapLibre over Leaflet
   removes Leaflet's lat-first `setView` footgun entirely.)
2. **Round-trip is approximate** — never claim exact distance/grade. Always surface requested vs
   actual (Req 1.4) in UI and tool output.
3. **Key leakage** — ORS key server-only; map tiles from a different, keyless/public source. A build
   that sends `ORS_API_KEY` to the browser (e.g. via a `NEXT_PUBLIC_` name) is a security bug.
4. **Coordinate privacy** (Req 2.4) — don't log raw coordinates; treat home location as sensitive.
5. **Tool schema strictness** (gotcha #36) — the single most likely silent failure. Keep
   `suggestRoute` inputs nullable+default, validate in `execute`, return structured results (never
   throw into the stream).
6. **Map lib SSR** — dynamic import with `ssr:false`; map libs break on the server.
7. **In-container deps** (gotcha #16) — adding `maplibre-gl` needs an in-container install +
   recreate, not just a host `npm install`.
8. **Mobile-first + touch** (gotcha #23) — no hover-only controls; verify the map and controls on a
   phone viewport. The map must not eat the whole screen so controls/summary stay thumb-reachable.
9. **Cost/latency** — ≤3 ORS calls/request (Req 7.2); bounded timeout; cache in `suggested_routes`
   so re-views don't re-hit ORS.
10. **Reuse, don't fork** (Req 6.3) — chat tool, standalone API, and plan attach all call the one
    `suggestRoute` service.

---

## Testing strategy

- **Unit**: coordinate conversion helpers ([lng,lat] ↔ display); terrain selection (given N
  candidate ascents, flat picks min, uphill picks max); elevation-profile sampling; `classifyOrsError`
  sentinel mapping (mirror `errors.test.ts`).
- **Unit**: `resolveStart` priority chain (explicit > browser > home > last activity), including the
  NO_LOCATION path.
- **Integration (mocked ORS fetch)**: `suggestRoute` happy path writes one `suggested_routes` row
  with correct normalised fields; `ORS_NO_ROUTE`/timeout writes nothing and surfaces the sentinel;
  attach sets `planned_session_id`.
- **Tool**: `suggestRoute` schema accepts the args the model actually sends (all omitted → all null),
  clamps distance, and returns `needsLocation` instead of throwing when unresolved (regression guard
  for gotcha #36).
- **Manual**: standalone `/routes` on a phone viewport — request a 5k flat loop from browser geo,
  see map + elevation + honest summary; attach a route to a plan long-run session; verify the ORS
  key never appears in the client bundle/network as a query param.
- **Build/lint**: `npm run build` + `npx eslint` in-container (gotcha #28 — eslint catches
  set-state-in-effect that build doesn't; relevant for the map/controls client components).
```