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

### Task 2.6 — Voice Interface — DONE
- [x] Create `VoiceRecorder` component (tap-to-record/stop, transcribing spinner, mic
      permission errors) + `useRecorder` hook (MediaRecorder, mime detection)
- [x] Implement `POST /api/ai/voice/transcribe`:
  - Receive audio blob; TRANSCRIPT-ONLY (audio discarded, not stored)
  - Uses OpenAI `/audio/translations` → English output regardless of spoken language
    (English-only pre-i18n; TODO(i18n) marker to switch to `/transcriptions` + user language)
- [x] Wire transcription → chat input (editable before send)
- [x] TTS for AI responses: Web Speech API `SpeechSynthesis`, read-aloud toggle persisted in
      localStorage, cancels on new message
- [ ] (deferred) animated waveform; voice/text explicit mode toggle

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

### Task 2.9 — Per-Session Notes (voice-transcribed, TRANSCRIPT-ONLY, stored for RAG)

> **What & why**: Right after (or any time viewing) a session, the athlete records a quick
> voice note — "legs felt heavy the last 3k", "new shoes, no blisters", "cut it short, calf
> tight". It's transcribed, attached to that activity, and embedded so the coach can recall it
> later ("last time you ran this route your calf was tight"). This is subjective context the
> device data can't capture. Reuses the Whisper transcription from Task 2.6.
>
> **MULTIPLE notes per session**: an activity can have any number of notes (one-to-many).
> The athlete can add notes at different times (e.g. right after the run, then again that
> evening). Each note is a separate `activity_notes` row + its own embedded RAG copy.
>
> **Editable before submit**: whether voice-transcribed or typed, the note text is shown in
> an editable field and only persisted when the athlete confirms (Save). Voice fills the
> field; the athlete can correct the transcription before saving.
>
> **Storage decision: transcript-only. Do NOT persist the audio by default.**
> Rationale: the transcript is the only artifact the app uses (RAG, coaching context, search,
> insight). Raw audio accumulates in object storage forever for near-zero value, adds cost,
> and is more privacy/GDPR-sensitive (biometric-adjacent, may capture background audio). The
> fix for a bad transcription is editing the text before save, not replaying audio.
> The `audio` Storage bucket + an `audio_url` column remain available so replay/re-transcribe
> can be enabled later behind an opt-in preference — a one-flag change, nothing to rip out.

**Data model** — DONE
- [x] Migration `010_activity_notes.sql`: `activity_notes` table (id, user_id, activity_id FK
      cascade, transcript, source 'voice'|'text', duration_s nullable, audio_url NULLABLE,
      embedding vector(1536), created_at; RLS own-rows). Notes also mirrored into
      `coaching_messages` (kind `session_voice_note`) for RAG.

**Capture + transcribe (transcript-only)** — DONE
- [x] `SessionNotes` uses `VoiceRecorder` on the activity detail page
- [x] `POST /api/activities/[id]/notes`: auth + ownership; audio OR typed text; audio
      discarded (transcript-only); embeds transcript; inserts `activity_notes` +
      `coaching_messages` mirror; MULTIPLE notes per session (one-to-many)
- [x] `GET /api/activities/[id]/notes` — chronological list
- [x] `DELETE /api/activities/[id]/notes/[noteId]` — deletes note + its mirror

**UI** — DONE
- [x] `SessionNotes` on `/activities/[id]`: record → editable transcript preview OR type
      directly; SAVE persists (editable before submit); list of notes with timestamp + delete;
      empty-state prompt; supports adding many notes

**RAG wiring**
- [x] Session notes embedded into `coaching_messages` → retrievable by the coach (Task 2.10)
- [ ] Post-session insight prompt: feed existing notes' transcripts so the AI accounts for
      subjective feel (pending — wire into the insight route)

**Deferred (opt-in, only if replay/re-transcription proves valuable)**
- [ ] Add a user preference "keep audio recordings"; when on, upload the blob to
      `{user_id}/audio/notes/...`, set `audio_url`, add playback UI + delete-object cleanup.
      Everything needed (bucket, nullable column) already exists — this is purely additive.

### Task 2.10 — Coach memory: pgvector HYBRID retrieval + context budgeting + durable facts

> **Memory model = pgvector hybrid search, not pure RAG.** Long-term recall combines
> embedding similarity WITH structured signals (recency, kind, activity link) and the typed
> tools (exact/current facts). See `.kiro/steering/decisions.md` → "Coach memory". Do not
> replace the typed tools with semantic search, and do not add an external vector DB.

> **Problem being solved**: The chat route forwards the client's message history to the LLM
> each turn. That grows unbounded → rising token cost and eventual context-limit errors, and
> it's also NOT real memory (truncating the window silently drops earlier facts).
>
> **Interim safety net (already shipped in the chat route)**: a blunt recency cap —
> `MAX_CONTEXT_MESSAGES = 20` most-recent messages, each clamped to `MAX_MESSAGE_CHARS = 8000`.
> This bounds cost/overflow today but loses older context. This task replaces that with a
> proper layered memory. Keep the cap as the outer guardrail even after RAG.

**Context assembly (the "budget" the coach sees each turn)** — build in priority order,
each layer with its own token budget so the total stays well under the model limit:
- [ ] **System prompt** — persona + today's context (profile, goal, readiness). ~fixed.
- [ ] **Durable facts** (see below) — compact, always included. Small budget (~300 tokens).
- [ ] **RAG snippets** — top-K semantically relevant past messages/notes for THIS query.
      Budget ~800 tokens; K capped (e.g. 5); drop anything below a similarity threshold.
- [ ] **Recent window** — last N turns verbatim (the recency cap above). Budget ~1500 tokens.
- [ ] Implement a `assembleCoachContext(userId, currentMessage)` helper that returns the
      final message array, enforcing per-layer budgets (approx tokens via chars/4) and never
      exceeding a global ceiling. Log the assembled size for tuning.

**Durable facts (structured long-term memory, not chat replay)**
- [ ] Migration: `athlete_facts` table — id, user_id, fact (text), category
      ('injury'|'preference'|'constraint'|'goal'|'equipment'|'other'), source
      ('inferred'|'stated'), confidence, active (bool), created_at, updated_at. RLS own-rows.
- [ ] Extraction: after a chat turn (or on a schedule), run a cheap LLM pass to extract/refresh
      durable facts from the conversation ("I prefer morning runs", "recurring left calf
      tightness", "no gym on Mondays"). Upsert; deactivate stale/contradicted facts rather
      than deleting (audit trail).
- [ ] Inject only `active` facts into the system prompt (the "Durable facts" layer above),
      newest/highest-confidence first, within budget. Dismissed facts are never injected AND
      act as a negative signal so the extractor doesn't silently re-infer them.
- [ ] **Explicit user removal (required, AI-independent — see decisions.md)**:
  - UI: "What your coach remembers" list in Settings; each fact has a Remove control.
    `PATCH /api/facts/[id]` (dismiss: active=false + reason/timestamp) and
    `DELETE /api/facts/[id]` (hard-delete for GDPR erasure). This path must work with NO AI
    in the loop.
  - Conversational: coach recognises "forget that / not true anymore" and calls a `dismissFact`
    typed tool. Convenience layer only — never the sole way to remove a fact.
  - Removal is soft-dismiss by default (reversible, audited); hard-delete offered explicitly.
- [ ] Also let the athlete edit a fact's text and add a fact manually in the Settings editor.

**Memory retrieval — pgvector HYBRID search (NOT pure RAG) — DONE**

> DECISION (see `.kiro/steering/decisions.md`): memory is pgvector hybrid search in our own
> Postgres — embedding similarity COMBINED with structured signals (recency/date window,
> `metadata.kind`, `activity_id`) and the typed tools that fetch exact current facts. It is
> NOT semantic RAG alone (which hallucinates relevance, ignores recency, and misses exact
> numbers) and NOT an external vector DB (no mem0/Pinecone). Typed tools remain the source of
> truth for precise/current data; retrieval adds subjective/historical context on top.

- [x] Embeddings on write for `coaching_messages` (chat + insight; session notes inherit it)
      via OpenAI `text-embedding-3-small` (1536-dim) — `lib/ai/embeddings.ts`
- [x] Hybrid retrieval: embed the current user message, call `search_coaching_messages`
      (migration 005 — vector cosine + date filter), take top-K (5) above threshold (0.3),
      inject as a "relevant past context" system message — `lib/ai/memory.ts`, wired in chat
- [x] Layered alongside typed tools (exact facts) + recent window — never vector-only
- [x] Backfill: `POST /api/ai/memory/backfill` (idempotent; embedded existing 33 rows)
- [x] Verified: query "fatigue score" retrieves the right past msgs at 0.62-0.67 similarity

**Cost & safety guards**
- [x] Embed only on write (never re-embed unchanged); retrieval K capped at 5
- [x] Keep the recency cap + per-message char clamp as the outer guardrail
- [ ] Best-effort: if no OpenAI key, embedding is skipped and RAG degrades to recent-window

**Deferred to a later iteration** (enhancements beyond core recall):
- [ ] `assembleCoachContext` helper with explicit per-layer token budgets
- [ ] Durable facts: `athlete_facts` table + LLM extraction + inject + Settings editor
- [ ] Task 2.8 AI provider settings UI (backend resolver already supports per-user keys)
- [ ] Rate-limit the fact-extraction pass (don't run on every trivial turn).
- [ ] Unit-test `assembleCoachContext` budgeting (never exceeds ceiling; priority order holds)
      — fits the MVP testing plan (T1).

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

## Phase 7: Internationalisation (i18n) — deferred; English-only until then

> **Why deferred**: the app is intentionally English-only for now. Every language-facing
> surface currently pins English (e.g. voice transcription forces `language='en'` via
> `TRANSCRIBE_LANGUAGE` in `api/ai/voice/transcribe`). This phase makes the app
> multilingual end-to-end: UI text, formatting, voice, and AI output.
>
> **Groundwork already in place** (don't re-invent): `user_settings.language` and
> `user_settings.units` columns exist; onboarding can already set a locale later. The voice
> route has a `TODO(i18n)` marker at the single point that needs to change. Search the
> codebase for `TODO(i18n)` before starting — each marks a spot to revisit.
>
> **Pieces can be pulled forward individually** — none of this blocks other phases. If a
> second language is needed sooner (e.g. French for you), do 7.1 + 7.2 + the voice bit of 7.4
> and ship.

### Task 7.1 — Locale foundation
- [ ] Pick the library: `next-intl` (recommended for App Router — server + client, typed
      messages) or `next-i18next`. Default to `next-intl`.
- [ ] Add locale routing/detection: default `en`; detect from `user_settings.language`, then
      `Accept-Language`, then fallback. Persist the chosen locale in `user_settings.language`.
- [ ] Set `<html lang>` dynamically; add a language switcher in `/settings`.
- [ ] Decide URL strategy: prefer a cookie/`user_settings`-driven locale (no `/[locale]/`
      path segment) to avoid restructuring all routes — simpler for an authed app.

### Task 7.2 — Extract & translate UI strings
- [ ] Externalise all hardcoded UI copy into message catalogs (`messages/en.json`, then
      `messages/fr.json`, etc.). Cover: nav, dashboard, activities, coach, plan, nutrition,
      settings, onboarding, login, uploader statuses, error/toast messages, empty states.
- [ ] Replace inline strings with `t('key')` lookups.
- [ ] Add a lint/check (or script) that flags untranslated/hardcoded strings.
- [ ] Provide `fr` translations first (primary second language); structure so adding more
      locales is drop-in.

### Task 7.3 — Locale-aware formatting
- [ ] Dates/times via `Intl.DateTimeFormat` with the active locale (replace the hardcoded
      `en-GB` in `lib/utils.ts` `formatDate`/`timeAgo`).
- [ ] Numbers via `Intl.NumberFormat`.
- [ ] Units: honour `user_settings.units` (metric/imperial) in `formatDistance`/`formatPace`
      (pace already partly there) — km/mi, m/ft; keep storage in SI, format at the edge.

### Task 7.4 — Voice & AI output in the user's language
- [ ] **Voice input**: replace `TRANSCRIBE_LANGUAGE='en'` with the user's
      `user_settings.language`, using `/audio/transcriptions` + `language` hint so the
      transcript stays in the spoken language (today it's pinned to English on purpose).
- [ ] **Decide the storage-language policy for RAG**: either (a) store transcripts/messages in
      the user's language and embed multilingually (`text-embedding-3-*` are multilingual), or
      (b) keep an English canonical copy for retrieval + a display copy. Recommend (a) —
      simpler, embeddings are multilingual, and the LLM handles cross-lingual context.
- [ ] **AI responses**: instruct the CoachAgent (system prompt) to reply in the user's
      `language`. Inject the locale into `buildCoachSystemPrompt`.
- [ ] **Read-aloud (TTS)**: pass a matching `lang`/voice to `SpeechSynthesisUtterance` so the
      browser picks a voice for the active locale.

### Task 7.5 — QA & content
- [ ] Pseudo-localisation pass (catch clipped/hardcoded strings, layout overflow).
- [ ] RTL check if any RTL locale is added later (defer unless needed).
- [ ] Translate transactional/system copy (auth emails, error pages) if applicable.
- [ ] Add i18n smoke tests: switch locale → key screens render translated; formatting matches.

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
