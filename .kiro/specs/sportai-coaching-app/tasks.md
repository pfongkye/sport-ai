# SportAI Coaching App — Implementation Tasks

> **MCP Strategy**: Mastra typed tools handle performance-critical, schema-bound operations
> (training load calc, plan generation, RLS-enforced queries). MCP servers handle flexible,
> open-ended operations (ad-hoc DB queries, web fetch, long-term memory, file inspection).

---

## Phase 1: Core Foundation

### Task 1.1 — Project Scaffold
- [ ] Initialize Next.js 14 project with App Router, TypeScript, Tailwind CSS
- [ ] Install and configure shadcn/ui component library
- [ ] Set up ESLint, Prettier, and path aliases (`@/`)
- [ ] Create `docker-compose.yml` with Next.js app service
- [ ] Add Supabase self-hosted stack to docker-compose (official supabase/supabase)
- [ ] Create `.env.local.example` with all required environment variables documented
- [ ] Set up `src/` directory structure:
  ```
  src/
    app/              # Next.js App Router pages
    components/       # Shared UI components
    components/ui/    # shadcn/ui primitives
    lib/              # Utilities, clients, helpers
    lib/supabase/     # Supabase client (server + client)
    lib/importers/    # Activity file parsers
    lib/ai/           # Mastra agents, tools, workflows
    lib/ai/tools/     # Typed Mastra tools
    lib/ai/agents/    # Agent definitions
    lib/ai/workflows/ # Multi-step workflows
    lib/mcp/          # MCP client configuration
    types/            # TypeScript interfaces
    hooks/            # React custom hooks
  ```
- [ ] Add Ngrok configuration instructions to README

### Task 1.2 — Supabase Setup
- [ ] Write and run all database migrations (profiles, activities, activity_streams,
      training_plans, planned_sessions, coaching_messages, nutrition_logs, user_settings)
- [ ] Enable pgvector extension (`CREATE EXTENSION IF NOT EXISTS vector`)
- [ ] Apply all RLS policies
- [ ] Create Supabase Storage buckets: `activities`, `nutrition`, `audio`
- [ ] Set storage bucket policies (authenticated users, own path prefix: `{user_id}/...`)
- [ ] Enable pgcrypto for API key encryption
- [ ] Create `encrypt_api_key` and `decrypt_api_key` Postgres functions
- [ ] Create seed script for local dev (test user + 10 sample activities)

### Task 1.3 — Authentication
- [ ] Install `@supabase/ssr` and configure server/client Supabase helpers
- [ ] Create `/login` page with social login buttons (Google, Apple, Facebook, Strava)
- [ ] Configure OAuth providers in Supabase (document redirect URI setup for Ngrok)
- [ ] Implement auth middleware (`middleware.ts`) to protect all `/dashboard`, `/coach`,
      `/plan`, `/activities`, `/nutrition`, `/settings` routes
- [ ] Create `/onboarding` page: profile form (name, DOB, weight, height, sport prefs,
      primary goal, training days availability)
- [ ] Implement redirect flow: new user → `/onboarding` → `/dashboard`
- [ ] Implement user profile API routes: `GET /api/profile`, `PUT /api/profile`
- [ ] Add account deletion flow with full data purge (CASCADE deletes + storage cleanup)

### Task 1.4 — Activity File Upload & Parsing
- [ ] Install `fit-file-parser`, `gpxparser` npm packages
- [ ] Create `src/lib/importers/fit.ts` — parse .FIT to normalized activity object + streams
- [ ] Create `src/lib/importers/gpx.ts` — parse .GPX to normalized activity + GPS stream
- [ ] Create `src/lib/importers/tcx.ts` — parse .TCX to normalized activity
- [ ] Create `src/lib/importers/index.ts` — route by extension, return `NormalizedActivity`
- [ ] Create `src/types/activity.ts` — shared TypeScript types for normalized schema
- [ ] Implement `POST /api/activities/upload`:
  - Accept multipart form upload (max 50MB)
  - Validate file type (.fit, .gpx, .tcx only)
  - Store raw file in Supabase Storage `{user_id}/activities/{filename}`
  - Parse and normalize using importer
  - Calculate training load (TRIMP: duration × avg_hr_factor)
  - Deduplicate by hash of (started_at + duration_s + distance_m)
  - Store activity + streams in DB
  - Return activity record
- [ ] Create `ActivityUploader` component:
  - Drag-and-drop zone + file picker button
  - Multi-file support (batch upload)
  - Per-file progress indicator
  - Error state per file with message
  - Success state with link to activity

### Task 1.5 — Manual Activity Logging
- [ ] Create manual activity form component (sport type, date, duration, distance,
      RPE 1-10, notes)
- [ ] Extend form for gym sessions: sets/reps/weight stored as jsonb in `raw_data`
- [ ] Implement `POST /api/activities` for manual entries (source: `manual`)

### Task 1.6 — Activity List & Detail
- [ ] Implement `GET /api/activities` with pagination (cursor-based) and filters
      (sport_type, date range, source)
- [ ] Create `/activities` page with activity feed:
  - Sport icon, type badge, date, distance, duration, avg HR
  - Filter bar (sport, date range)
  - Infinite scroll or pagination
  - Upload button (opens uploader modal)
- [ ] Install `leaflet`, `react-leaflet`
- [ ] Create `ActivityMap` component rendering GPS track from `latlng` stream
      (with start/end markers, elevation coloring)
- [ ] Install `recharts`
- [ ] Create `MetricsChart` component — configurable time-series (HR, pace, cadence,
      altitude, power) with zoom and crosshair
- [ ] Create `/activities/[id]` page:
  - Stats header (distance, duration, pace, HR, cadence, load)
  - GPS map (if location data available)
  - Metrics charts with stream data
  - Lap splits table
  - AI coaching insight section (populated in Phase 2)
- [ ] Implement `DELETE /api/activities/[id]` with storage file cleanup

### Task 1.7 — Basic Dashboard
- [ ] Create `/dashboard` page layout (responsive 2-column on desktop, single on mobile)
- [ ] Recent activity feed component (last 5, with sport icon and key stats)
- [ ] This-week summary card (total km, hours, sessions by sport)
- [ ] Placeholder card for AI Coach (to be wired in Phase 2)
- [ ] Placeholder card for Readiness Score (to be wired in Phase 3)
- [ ] Placeholder card for Training Plan week (to be wired in Phase 3)

---

## Phase 2: AI Coaching (with MCP)

### Task 2.1 — Mastra + MCP Setup
- [ ] Install `@mastra/core`, `@mastra/mcp`, relevant provider packages
- [ ] Create `src/lib/ai/mastra.ts` — Mastra instance with agent registry
- [ ] Create `src/lib/mcp/client.ts` — MCPClient with servers:
  - `supabase-mcp`: ad-hoc DB queries (open-ended stats, aggregations)
  - `fetch-mcp`: YouTube search, USDA food lookup, web research
  - `memory-mcp` (mem0): long-term user preferences and injury history
  - `filesystem-mcp`: raw uploaded file inspection (dev/debug only)
- [ ] Create `.kiro/settings/mcp.json` for Kiro IDE MCP integration (dev tooling)
- [ ] Configure MCP environment variables in `.env.local.example`
- [ ] Write `src/lib/ai/prompts/coach.ts` — base system prompt for CoachAgent:
  - Athletic coaching persona
  - Awareness of user's goal (marathon 3h30)
  - Instructions on tool usage priority (typed tools first, MCP for open queries)
  - Readiness-aware tone (check fatigue before prescribing hard sessions)

### Task 2.2 — Mastra Typed Tools
- [ ] `getRecentActivities(userId, limit, sportType?)` — last N activities with key metrics
- [ ] `getTrainingLoad(userId)` — compute ATL (7d), CTL (42d), TSB, return readiness score
- [ ] `getPlannedSessions(userId, fromDate, toDate)` — upcoming plan sessions
- [ ] `matchActivityToSession(activityId, sessionId)` — link completed to planned
- [ ] `updateSessionStatus(sessionId, status, notes?)` — mark complete/skipped/modified
- [ ] `triggerPlanUpdate(userId, reason)` — invoke PlanUpdateWorkflow
- [ ] `getUserProfile(userId)` — profile + goal + training availability

> **Note**: Open-ended queries ("how many km in March?", "best 5k this year") are handled
> by the Supabase MCP server — no need to write a typed tool for every possible stat query.

### Task 2.3 — CoachAgent
- [ ] Define `CoachAgent` in `src/lib/ai/agents/coach.ts`:
  - All typed Mastra tools attached
  - MCP tools injected (supabase, fetch, memory)
  - System prompt from `prompts/coach.ts`
  - pgvector memory store (hybrid retrieval: vector + date filter)
- [ ] Implement conversation history injection (last 10 messages + RAG context)
- [ ] Implement embedding generation on each stored message (OpenAI embeddings or provider-agnostic via Mastra)

### Task 2.4 — Coaching Chat API
- [ ] Implement `POST /api/ai/chat` with streaming (Vercel AI SDK `streamText`):
  - Validate session (user auth)
  - Resolve user's AI provider + decrypt API key
  - Inject conversation history + RAG context
  - Stream CoachAgent response
  - Persist user message + assistant response with embeddings
- [ ] Implement `GET /api/ai/chat/history` — paginated message history

### Task 2.5 — Chat UI
- [ ] Create `ChatInterface` component:
  - Message list with streaming token display
  - User/assistant bubble styling
  - Markdown rendering (react-markdown + remark-gfm)
  - Tool call display (collapsible "CoachAgent checked your activities...")
  - Voice toggle button
  - Text input + send (Enter to submit)
  - Auto-scroll with scroll-to-bottom button
- [ ] Create `/coach` page with full-screen chat + voice panel sidebar

### Task 2.6 — Voice Interface
- [ ] Create `VoiceRecorder` component:
  - Hold-to-record button with animated waveform (Web Audio API)
  - Release to send
  - Transcription preview before submitting (editable)
  - Mic permission denied error state
- [ ] Implement `POST /api/ai/voice/transcribe`:
  - Receive audio blob (webm/wav)
  - Store audio in Supabase Storage `{user_id}/audio/{timestamp}.webm`
  - Send to Whisper API (or user's provider if Whisper-compatible)
  - Return transcript text
- [ ] Wire transcription → chat send flow
- [ ] TTS for AI responses: Web Speech API `SpeechSynthesis`
  - Auto-read toggle (on/off preference in localStorage)
  - Stop speaking on new user message
- [ ] Voice/text mode toggle persisted in localStorage

### Task 2.7 — Post-Session AI Insight
- [ ] After `ActivityProcessingWorkflow` completes, enqueue CoachAgent call
- [ ] Prompt: activity summary → reactive insight (pacing, HR zones, recovery advice)
- [ ] Store insight as `coaching_messages` record linked via `metadata.activity_id`
- [ ] Display insight card on `/activities/[id]` page
- [ ] Show "New insight" badge on activity in list

### Task 2.8 — AI Provider Settings
- [ ] Create `ProviderSettings` component:
  - Provider dropdown: OpenAI / Anthropic / Google Gemini / Mistral
  - Model selector (filtered per provider: gpt-4o, claude-3-5-sonnet, gemini-1.5-pro, mistral-large)
  - API key input (password field, show/hide toggle)
  - "Test Connection" button → POST /api/settings/ai-provider/test
  - Save with confirmation toast
  - "Remove key" option (reverts to system default)
- [ ] Implement `PUT /api/settings/ai-provider` — encrypt key with pgcrypto, store
- [ ] Implement `POST /api/settings/ai-provider/test` — minimal API call to validate key
- [ ] Create provider resolver `src/lib/ai/provider.ts`:
  - Decrypt user key server-side
  - Return configured Mastra provider client
  - Fall back to `process.env.OPENAI_API_KEY` if no user key

---

## Phase 3: Planning & Adaptation

### Task 3.1 — PlannerAgent & Workflows
- [ ] Create `PlannerAgent` in `src/lib/ai/agents/planner.ts`:
  - Tools: getUserProfile, getActivityHistory (via Supabase MCP), generatePlan, updatePlan
  - MCP: Supabase MCP for training history aggregation
- [ ] Implement `ActivityProcessingWorkflow`:
  ```
  Upload → Parse → Normalize → Calculate load → Store →
  Match to planned session → Trigger post-session insight →
  Embed activity summary → Update plan if needed
  ```
- [ ] Implement `PlanUpdateWorkflow`:
  ```
  Receive trigger (fatigue / missed session / user request) →
  Fetch remaining plan sessions →
  Assess CTL/ATL →
  Adjust intensity/volume for next 2 weeks →
  Update planned_sessions in DB →
  Notify user via coaching_messages
  ```
- [ ] Implement `DailyReadinessWorkflow` (can be triggered on demand or scheduled):
  ```
  Get last 42 days activities →
  Calculate ATL (7d weighted EWMA of training load) →
  Calculate CTL (42d weighted EWMA) →
  TSB = CTL - ATL →
  Map TSB to readiness label + score (0-100) →
  Cache result in user_settings.metadata
  ```

### Task 3.2 — Training Plan Generation
- [ ] Implement `POST /api/plan/generate`:
  - Accept: goal, target_date, fitness_level ('beginner'|'intermediate'|'advanced'), weekly_hours
  - PlannerAgent generates week-by-week structure
  - For marathon: periodization with base → build → peak → taper phases
  - Include football + gym sessions in load calculation
  - Store plan + sessions in DB
- [ ] Add plan generation step to onboarding flow
- [ ] "Generate new plan" CTA on `/plan` page when no active plan

### Task 3.3 — Training Calendar
- [ ] Create `TrainingCalendar` component (week view, swipe left/right):
  - Session cards: sport icon, session type badge, target distance/duration
  - Status: pending (outlined) / completed (filled green) / skipped (grey) / modified (amber)
  - Click session: expand drawer with description, targets, AI notes, "Mark complete" button
  - Today highlighted
- [ ] Create `/plan` page:
  - Plan header (goal, end date, phase name, weeks remaining)
  - Calendar (current week default, week navigation)
  - Plan overview stats (total weeks, sessions per week, peak week volume)
- [ ] Implement `PUT /api/plan/sessions/[id]` (status, completed_activity_id, notes)
- [ ] Auto-match: after activity upload, find planned session same day + sport_type → suggest link

### Task 3.4 — Readiness Score
- [ ] Create `ReadinessScore` component:
  - Score gauge (0-100, color: red < 40, amber 40-60, green > 60)
  - Label: "Fresh" / "Optimal" / "Tired" / "Very Fatigued"
  - One-line coaching message
  - Expand to see ATL/CTL/TSB detail
- [ ] Implement `GET /api/ai/readiness`
- [ ] Wire readiness context into CoachAgent system prompt (injected per request)
- [ ] Display on dashboard

### Task 3.5 — Fatigue Adaptation
- [ ] Detect fatigue signals in CoachAgent:
  - Keyword patterns: "tired", "sore", "sick", "missed", "exhausted", "injury"
  - Low readiness score threshold (TSB < -20)
- [ ] On detection: call `triggerPlanUpdate` tool with reason
- [ ] Show plan diff to user before applying ("Here's what I'd change — approve?")
- [ ] Confirmation flow: user approves → apply; user rejects → keep current plan
- [ ] Allow manual override from calendar ("Adjust this session")

---

## Phase 4: Nutrition & Video

### Task 4.1 — Nutrition Photo Logging (with MCP)
- [ ] Create `NutritionCapture` component:
  - Camera button (mobile `capture="environment"`) + file upload fallback
  - Photo preview with crop/confirm
  - Loading skeleton during AI analysis
  - Editable food item list (name, quantity, unit)
  - Macro summary bar (P/C/F/Cal)
- [ ] Implement `POST /api/nutrition/analyze`:
  - Upload photo to Supabase Storage `{user_id}/nutrition/{timestamp}.jpg`
  - Send to OpenAI Vision API: identify food items with estimated portions
  - **Use Fetch MCP** to look up each food in USDA FoodData Central API
    (avoids writing a separate USDA API wrapper)
  - Calculate total macros
  - Store in nutrition_logs
- [ ] Create `NutritionAgent` in `src/lib/ai/agents/nutrition.ts`:
  - Tools: getNutritionHistory (via Supabase MCP), getUpcomingWorkouts
  - MCP fetch for food database queries and nutrition research
  - Provides contextual advice (e.g., "pre-long run carb loading")

### Task 4.2 — Nutrition Log & Insights
- [ ] Create `/nutrition` page:
  - Date picker (default: today)
  - Meals grouped by type (breakfast/lunch/dinner/snack/pre-post workout)
  - Daily macro progress bars (vs targets)
  - "Add meal" button → NutritionCapture modal
- [ ] Create `/nutrition/[id]` page: photo, item list, macro breakdown, edit form
- [ ] Implement `GET /api/nutrition?from=&to=` with date filter
- [ ] Implement `PUT /api/nutrition/[id]` for corrections
- [ ] CoachAgent nutrition tool: `getNutritionSummary(userId, date)` — daily macro totals
- [ ] Nutrition insights in coach chat: contextual fueling advice relative to training load

### Task 4.3 — YouTube Video Search (via Fetch MCP)
- [ ] **Use Fetch MCP** in CoachAgent/NutritionAgent to search YouTube:
  - Agent fetches `https://www.googleapis.com/youtube/v3/search?q=...&key=...`
  - No separate YouTube API wrapper needed — MCP fetch handles it
- [ ] Create `VideoSearch` component:
  - Search input (or pre-populated from agent suggestion)
  - Results grid: thumbnail, title, channel, duration
  - Click → embedded YouTube player modal
- [ ] Add video panel to `/coach` page (collapsible sidebar)
- [ ] CoachAgent can proactively suggest video searches as tool output:
  `{ type: 'video_suggestion', query: 'running cadence drill 180 bpm' }`
- [ ] Render video suggestions as interactive cards in chat bubbles

---

## Phase 5: Polish & PWA

### Task 5.1 — Data Visualisation
- [ ] Pace trend chart: last 30/90 days easy runs (pace vs date, with rolling average)
- [ ] HR zone distribution: stacked bar per activity (Z1-Z5 time in zone)
- [ ] Weekly volume chart: bar chart (km/week + hours/week dual axis)
- [ ] Training load chart: ATL/CTL/TSB line chart over 90 days
- [ ] Aerobic efficiency: pace vs HR scatter plot (lower HR = better efficiency over time)
- [ ] Goal progress: current estimated marathon pace vs 3h30 target pace line

### Task 5.2 — PWA
- [ ] Create `public/manifest.json` (name, icons 192/512, theme_color, display: standalone)
- [ ] Configure `next-pwa` with Workbox
- [ ] Cache strategy: dashboard + recent activities (stale-while-revalidate)
- [ ] Offline upload queue: store pending uploads in IndexedDB, sync on reconnect
- [ ] Service worker push notifications (readiness score, plan reminder)
- [ ] Test: install to Android Chrome home screen via Ngrok tunnel

### Task 5.3 — UX Polish
- [ ] Dark mode (Tailwind dark class + `next-themes`)
- [ ] Loading skeletons for all async components
- [ ] Empty states: new user (no activities, no plan, welcome prompt)
- [ ] Error boundaries with user-friendly fallback UI
- [ ] Mobile responsive audit: all pages tested at 375px, 414px, 768px
- [ ] Accessibility: keyboard navigation, ARIA labels, focus management, color contrast

### Task 5.4 — Performance
- [ ] Cursor-based pagination for activity list
- [ ] SWR or React Query for client-side caching
- [ ] `next/image` for all nutrition photos (auto-optimize)
- [ ] Rate limiting on AI endpoints (sliding window, per user)
- [ ] Bundle analysis (`@next/bundle-analyzer`) and code splitting audit

---

## Phase 6: SaaS Prep (Post-marathon)

### Task 6.1 — Strava API Integration
- [ ] Register Strava app at strava.com/settings/api
- [ ] Create `src/lib/importers/strava.ts` — map Strava activity fields to normalized schema
- [ ] Implement Strava OAuth connect flow (separate from login OAuth)
- [ ] Implement Strava webhook: `POST /api/webhooks/strava` (real-time activity push)
- [ ] Handle dedup: `external_id` = `strava_{activity.id}` prevents re-upload conflicts
- [ ] Add "Connect Strava" button to `/settings`

### Task 6.2 — Garmin API Integration
- [ ] Apply for Garmin Health API partnership
- [ ] Create `src/lib/importers/garmin.ts`
- [ ] Implement Garmin webhook handler
- [ ] Add "Connect Garmin" button to `/settings`

### Task 6.3 — Coros API Integration
- [ ] Apply for Coros Open API access at open.coros.com
- [ ] Create `src/lib/importers/coros.ts`
- [ ] Implement Coros OAuth sync
- [ ] Add "Connect Coros" button to `/settings`

### Task 6.4 — AI Gateway
- [ ] Evaluate Portkey vs Cloudflare AI Gateway
- [ ] Route all AI calls through gateway endpoint
- [ ] Per-user usage tracking and cost dashboard
- [ ] Provider fallback rules (OpenAI down → Anthropic)

### Task 6.5 — Multi-Tenant & Coach Portal
- [ ] Add `tenants` table with tenant_id on profiles
- [ ] Extend RLS policies for tenant-scoped access
- [ ] Coach portal: view athlete list, sessions, stats (with athlete permission)
- [ ] Athlete invite flow (email link → accept → join tenant)

### Task 6.6 — Billing
- [ ] Stripe integration (subscriptions)
- [ ] Free tier limits (storage, AI calls/month)
- [ ] Usage tracking enforcement
- [ ] Upgrade/downgrade UI

---

## Testing (introduce at MVP, then maintain going forward)

> **Timing**: hold off on a big test suite while the surface area is still churning.
> Introduce automated tests once the MVP is feature-complete (end of Phase 2 / start of
> Phase 3 — auth + activity ingestion + AI chat working), then require tests for every new
> feature and every bug fix from that point on. The goal is regression protection, not 100%
> coverage.

### Test stack
- [ ] **Unit / integration**: Vitest (fast, TS-native, jsdom for React)
- [ ] **Component**: React Testing Library (`@testing-library/react` + `user-event`)
- [ ] **E2E**: Playwright (real browser, tests the auth + upload + coach flows)
- [ ] **API/DB**: Vitest against a disposable Supabase test DB (Docker), NOT the dev DB
- [ ] Add `test`, `test:watch`, `test:e2e`, `test:coverage` scripts to package.json

### T1 — Pure logic unit tests (highest ROI, do first)
- [ ] `lib/importers/helpers.ts`: training load (TRIMP + RPE fallback), dedup hash stability,
      haversine distance, elevation gain, avg/max helpers
- [ ] `lib/importers/gpx.ts`: parse a fixture .GPX → assert distance/duration/HR/pace/streams
- [ ] `lib/importers/tcx.ts`: parse a fixture .TCX → assert summary + streams
- [ ] `lib/importers/fit.ts`: parse a fixture .FIT (small real Coros export, scrubbed) → assert
- [ ] `lib/utils.ts`: formatDuration, formatPace, formatDistance, timeAgo edge cases
- [ ] `lib/ai/tools`: getTrainingLoad EWMA math (ATL/CTL/TSB) against known inputs
- [ ] Store test fixtures in `app/src/__fixtures__/` (scrub any real GPS/PII)

### T2 — API route tests
- [ ] `POST /api/activities/upload`: valid file → 201 + activity row; unsupported → error;
      oversize → error; duplicate → `duplicate` status; unauth → 401 JSON
- [ ] `GET /api/activities`: pagination cursor, sport filter, date range
- [ ] `GET/DELETE /api/activities/[id]`: ownership enforced, storage cleanup on delete
- [ ] `POST /api/ai/chat`: auth required; streams; persists messages (mock the LLM provider)
- [ ] Nutrition + plan routes as those phases land

### T3 — RLS / tenant isolation tests (security-critical)
- [ ] Seed two users; assert user A cannot SELECT/UPDATE/DELETE user B's activities,
      streams, plans, messages, nutrition, settings
- [ ] Assert storage policies: user A cannot read user B's `{user_id}/...` objects
- [ ] Run these against the real Postgres with RLS on (not the service-role client)

### T4 — Component tests
- [ ] `ActivityUploader`: drag-drop adds files, shows per-file status, calls API
- [ ] `ActivitiesView`: sport filter, empty state, renders feed
- [ ] `LoginForm`: renders providers, triggers signInWithOAuth (mocked)
- [ ] `OnboardingForm`: validation, two-step flow, submit
- [ ] `ChatInterface`: renders streamed messages, markdown, tool-call display

### T5 — E2E (Playwright, the critical happy paths)
- [ ] Auth: login (mock OAuth or test email) → onboarding → dashboard
- [ ] Upload: sign in → upload fixture .GPX → appears in feed → detail shows map + charts
- [ ] Coach: send a message → receive a response (mock LLM) → history persists
- [ ] Run E2E against the Docker stack in CI

### T6 — CI wiring
- [ ] GitHub Actions: on PR run lint → type-check → `vitest run` → RLS tests
- [ ] Spin up Supabase + app in CI (docker compose) for API/RLS/E2E jobs
- [ ] Playwright E2E as a separate job (can be `continue-on-error` initially, then required)
- [ ] Coverage report artifact; set a soft threshold (e.g. 60%) that rises over time
- [ ] Block merge on unit + type-check + RLS passing

### Testing conventions (from MVP onward)
- [ ] Every bug fix ships with a regression test that fails before the fix
- [ ] Every new API route ships with auth + happy-path + one error-path test
- [ ] Every new table ships with an RLS isolation test
- [ ] Keep unit tests fast (<5s total) so they run on every save; heavier suites in CI

---

## Cross-Cutting (all phases)

- [ ] Error logging: Sentry SDK (`@sentry/nextjs`)
- [ ] Structured logging for API routes (`pino` or similar)
- [ ] RLS integration tests: verify no cross-user data leakage (see Testing → T3)
- [ ] Document all env vars in `.env.local.example`
- [ ] GitHub Actions CI: lint + type-check + tests on PR (see Testing → T6)
- [ ] Ngrok setup guide in README (stable domain for OAuth callbacks)
- [ ] Security: never read/commit secret files (enforced by `.kiro/steering/security.md`
      and the `block-secret-reads` PreToolUse hook)
