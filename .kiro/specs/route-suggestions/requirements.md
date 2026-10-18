# Route & Itinerary Suggestions — Requirements

## Overview

Add a geo/routing layer that proposes real, runnable routes to the athlete: a loop of roughly
N kilometres near a location, with a map, an elevation profile, and a simple terrain label
(flat vs uphill). Routes are usable in two places:

1. **Standalone** — "suggest me a 12k route near me" (a dedicated route UI and a chat tool), and
2. **Attached to a plan** — a planned long-run session can carry a suggested route.

This complements the separate `training-plan-generation` spec rather than replacing it. That spec
owns the *planning brain* (fatigue/programme/goals → dated sessions, as a deterministic workflow).
This spec owns the *where you run it* layer and plugs into the plan where a session needs a route.

## Design stance (why this is NOT a new free-roaming agent)

The user asked for "a dedicated agent to plan according to fatigue, programme and goals." That
capability is already specced as `training-plan-generation` — a deterministic workflow + one
structured LLM call, chosen because plan output is schema-bound. We do **not** re-litigate that
decision here (see `.kiro/steering/decisions` — settled architecture: typed tools for schema-bound
ops, agent only for flexible ops). Route generation is likewise schema-bound geo data, so it is a
**typed tool + deterministic service** calling OpenRouteService (ORS), not an autonomous agent. The
coach agent *invokes* the `suggestRoute` tool; it does not free-roam the routing.

---

## Settled technical decisions (from iteration with the user)

- **Routing provider: OpenRouteService (ORS).** Fits the self-hosting ethos of the stack. Use the
  ORS Directions round-trip option for true loops of ~N km. Foot profile (`foot-walking`).
- **Endpoint-configurable.** The ORS client reads `ORS_BASE_URL` + `ORS_API_KEY` so the app can
  start on the hosted ORS free tier and later point at a self-hosted ORS container with no code
  change. Default base URL = the public ORS API.
- **Location source.** Stored home location (new field) is primary; browser geolocation at request
  time overrides/supplements it; past-activity GPS start points are a fallback. The athlete may
  also name a location in chat.
- **Landscape v1 = flat vs uphill only.** Derived from ORS elevation data (total ascent over the
  loop). Generate a few candidate seeds and pick/label by computed ascent — best-effort, NOT a
  guarantee of an exact grade or an exact distance.
- **Both surfaces** ship: standalone route suggestion AND plan long-run attachment. Standalone is
  built first so the feature is useful even with no active plan.

---

## Requirements

### 1. Route generation (core service)

- **1.1** MUST generate a **circular (round-trip) route** of approximately a requested distance
  (km) starting/ending at a given coordinate, using ORS Directions round-trip for the
  `foot-walking` profile.
- **1.2** MUST request and parse **elevation** so each route has a total ascent (m), a descent (m),
  and an elevation profile (sampled points) usable for display.
- **1.3** MUST support a **terrain preference** of `flat` or `uphill`. The service generates a small
  number of candidate routes (varying the ORS round-trip seed) and selects one matching the
  preference by computed ascent (lowest ascent for `flat`, highest for `uphill`). This is
  best-effort; the actual distance and ascent are approximate.
- **1.4** MUST return, per route: a GeoJSON LineString geometry, actual distance (m), total ascent
  and descent (m), the terrain label applied, a bounding box, and the requested vs actual distance
  so the UI/coach can be honest about the approximation.
- **1.5** MUST run server-side. The ORS key is a server secret and MUST NOT reach the browser.
- **1.6** MUST handle ORS failure gracefully: rate limits (HTTP 429), auth failure (403/401),
  no-route-found, and timeouts each map to a clear, distinct result the caller can relay — never an
  unhandled throw that kills a chat turn (mirror the Strava client's sentinel pattern).
- **1.7** The ORS client MUST be endpoint-configurable via `ORS_BASE_URL` (default public ORS) and
  `ORS_API_KEY`, with a bounded request timeout.

### 2. Location resolution

- **2.1** MUST resolve a start coordinate from, in priority order: (a) an explicit coordinate/named
  place in the request, (b) browser geolocation passed by the client, (c) the athlete's **stored
  home location**, (d) the most recent activity's GPS start point.
- **2.2** MUST store an optional **home location** for the athlete: latitude, longitude, and a human
  label. Editable in Settings. Nullable (the feature degrades to geolocation/activity fallback when
  unset).
- **2.3** When a location is named in text (e.g. "near Hyde Park"), the service MAY geocode it via
  ORS geocoding; if geocoding is unavailable or ambiguous, it MUST ask the athlete to confirm or
  provide a coordinate rather than guess.
- **2.4** MUST NOT silently transmit the athlete's location to third parties beyond the configured
  ORS endpoint, and MUST treat stored/transmitted coordinates as sensitive (no logging of raw
  coordinates in plaintext app logs).

### 3. Persistence / caching

- **3.1** MUST cache generated routes in a `suggested_routes` table so repeat views don't re-hit
  ORS: geometry (GeoJSON), requested + actual distance, ascent/descent, terrain label, start
  coordinate, optional `planned_session_id` link, `created_at`, `user_id` (RLS owner-scoped).
- **3.2** A suggested route MAY be linked to a `planned_sessions` row (nullable FK) so a plan's
  long-run session can display its attached route.
- **3.3** All writes scoped to `user_id` with RLS. Migration applied manually (`014_*`), per the
  repo convention (AGENTS.md gotcha #4).

### 4. Chat integration (standalone)

- **4.1** SHOULD let the athlete ask for a route in chat ("suggest a 10k loop near me, something
  flat") via a `suggestRoute` typed tool in `buildCoachTools`.
- **4.2** The tool MUST follow the repo's tool-schema rules: model-facing optional inputs are
  `.nullable().default(null)` (never bare `.optional()`), no `.min/.max/.uuid` refinements on
  model-supplied values; validate/clamp inside `execute` (AGENTS.md gotcha #36).
- **4.3** The tool MUST return a concise summary (distance, ascent, terrain label, a short
  waypoint/landscape note) — not raw geometry — for the coach to read back. The coach MAY narrate
  expected landscape qualitatively from the route (e.g. "rolling, net uphill first half") but MUST
  NOT invent specific named landmarks that aren't supported by the data (consistent with gotcha #23:
  don't state facts the tools didn't provide).
- **4.4** When location cannot be resolved, the tool MUST return a result instructing the coach to
  ask the athlete for a location rather than failing silently.

### 5. Standalone route UI

- **5.1** MUST provide a surface where the athlete can request a route (distance + flat/uphill +
  location source) and see the result on a **map** with the route drawn and an **elevation
  profile**.
- **5.2** MUST show actual vs requested distance and the terrain label honestly.
- **5.3** Map rendering MUST use tiles that don't leak the ORS server key to the browser; use a
  free raster/vector tile source (e.g. OpenStreetMap raster tiles via a Leaflet/MapLibre client)
  and draw the server-returned GeoJSON on top. Tile usage MUST respect the tile provider's usage
  policy.
- **5.4** MUST be accessible: controls keyboard-operable and labelled; the map MUST have a text
  alternative/summary (distance, ascent, terrain) for screen-reader users since a map canvas is not
  readable on its own.
- **5.5** MUST be **mobile-first** (see Req 7.0): single-column reflow, touch-friendly controls and
  touch pan/zoom on the map, and no reliance on hover. The phone layout is the primary target since
  athletes plan and check routes on their phone.

### 6. Plan integration

- **6.1** SHOULD let a planned **long-run** session get a suggested route attached (via the
  `planned_session_id` link on `suggested_routes`), generated on demand from the session's target
  distance and the athlete's location.
- **6.2** The plan/session UI SHOULD surface the attached route (at least a summary + link to the
  map view). Attaching a route MUST NOT modify the planned session's training targets — it is
  additive context only.
- **6.3** Route attachment MUST reuse the SAME route-generation service as the standalone flow (no
  forked logic), mirroring the plan spec's "reuse, don't fork" rule.

### 7. Non-functional

- **7.0** **Mobile-first.** All UI in this spec MUST be designed for a phone screen first and scale
  up, not the reverse. Concretely: the map and elevation profile MUST be usable on a narrow
  viewport (no horizontal scroll, no clipped controls); request controls (distance, flat/uphill,
  location) MUST be touch-friendly (adequate hit targets, no hover-only interactions per gotcha
  #23 — interactive controls, especially any destructive ones, must be visible and tappable on
  touch); the map MUST support touch pan/zoom; and layout MUST reflow to a single column on small
  screens. Verify on a mobile viewport before considering any UI task done.
- **7.1** Route generation MUST have a bounded timeout and a graceful failure path (no partial/empty
  route rows written on failure).
- **7.2** Candidate generation MUST cap the number of ORS calls per request (e.g. ≤3 seeds) to bound
  cost/latency and respect ORS rate limits.
- **7.3** Env wiring (`ORS_BASE_URL`, `ORS_API_KEY`) MUST be documented in `.env.example` files and
  the Docker compose `app` service, and in the README, consistent with how Strava/AI keys are wired
  (app-side `.env.local`, not GoTrue's `docker/.env`).
- **7.4** MUST NOT introduce MCP into the app runtime (settled decision / gotcha #20). Routing is a
  typed tool + server service only.

---

## Out of scope (v1)

- Turn-by-turn navigation or live tracking.
- Multiple simultaneous route candidates shown as a gallery (return one chosen route; regenerate for
  another).
- Surface type (trail vs paved) and point-of-interest / scenery enrichment beyond flat-vs-uphill and
  a qualitative coach note.
- Exact-distance or exact-grade guarantees (round-trip output is approximate).
- Saving/favouriting routes as a managed collection, GPX export of suggested routes (nice later).
- Self-hosted ORS container provisioning (the client is endpoint-ready for it, but standing up the
  container is a separate ops task).
- i18n of route text (English-only now, per settled decision).
```