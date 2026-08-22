# SportAI Coaching App — Design

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                    Next.js 14 App (App Router)                │
│                                                              │
│  ┌────────────┐  ┌────────────┐  ┌──────────┐  ┌─────────┐  │
│  │  AI Coach  │  │  Training  │  │Dashboard │  │Nutrition│  │
│  │  Chat/Voice│  │  Plan/Cal  │  │& Stats   │  │& Photos │  │
│  └─────┬──────┘  └─────┬──────┘  └─────┬────┘  └────┬────┘  │
└────────┼───────────────┼───────────────┼─────────────┼───────┘
         │               │               │             │
┌────────▼───────────────▼───────────────▼─────────────▼───────┐
│                    API Layer (/api/*)                          │
│  /ai/chat  /ai/voice  /plan/*  /activities/*  /nutrition/*    │
└────────┬──────────────┬────────────────┬──────────────────────┘
         │              │                │
    ┌────▼────┐    ┌────▼────┐    ┌──────▼──────┐
    │  Mastra │    │Supabase │    │  External   │
    │  AI     │    │Postgres │    │  Services   │
    │  Agents │    │+pgvector│    │  YouTube    │
    │  Memory │    │+Storage │    │  Food APIs  │
    └─────────┘    └─────────┘    │  Whisper    │
                                  └─────────────┘
```

---

## Tech Stack

| Layer | Choice | Rationale |
|---|---|---|
| Frontend | Next.js 14 (App Router) | Fullstack, SSR, API routes, easy Vercel deploy |
| Styling | Tailwind CSS + shadcn/ui | Fast, consistent, accessible components |
| Charts | Recharts | Lightweight, React-native, good docs |
| Maps | Leaflet + react-leaflet | OSM tiles, free, GPX track rendering |
| AI Framework | Mastra AI | TypeScript-native, agent + memory + workflow |
| Auth | Supabase Auth | Multi-provider OAuth, RLS integration |
| Database | Supabase Postgres | RLS, pgvector, jsonb, realtime |
| Vector store | pgvector (in Supabase) | Avoids separate vector DB, hybrid search |
| Storage | Supabase Storage | Files, photos, audio — per-user buckets |
| Voice input | Web Speech API + Whisper | Browser native fallback + server transcription |
| Voice output | Web Speech API (TTS) | Browser native, no API cost |
| Nutrition vision | OpenAI Vision API | Food identification from photos |
| Food macros | USDA FoodData Central API | Free, comprehensive, no rate limit issues |
| .FIT parsing | fit-file-parser (npm) | Battle-tested, Coros/Garmin compatible |
| Video | YouTube Data API v3 | Search + embed |
| Dev infra | Docker Compose + Ngrok | Local full-stack + mobile testing |
| Prod hosting | Vercel + Supabase managed | Zero-ops, scales to SaaS |

---

## Database Schema

### auth.users (managed by Supabase)
Extended via `public.profiles`.

### public.profiles
```sql
CREATE TABLE public.profiles (
  id              uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name    text,
  avatar_url      text,
  date_of_birth   date,
  weight_kg       numeric(5,2),
  height_cm       numeric(5,2),
  sport_prefs     text[],              -- ['running', 'football', 'gym']
  primary_goal    text,                -- 'Marathon 3h30, November 2026'
  training_days   text[],              -- ['monday', 'wednesday', 'friday']
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can only access own profile"
  ON public.profiles FOR ALL USING (auth.uid() = id);
```

### public.activities
```sql
CREATE TABLE public.activities (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  source              text NOT NULL CHECK (source IN (
                        'upload_fit','upload_gpx','upload_tcx',
                        'strava','garmin','coros','manual')),
  external_id         text,            -- for dedup when APIs added later
  sport_type          text NOT NULL,   -- 'run','football','gym','cycle','other'
  started_at          timestamptz NOT NULL,
  duration_s          integer,
  distance_m          numeric(10,2),
  elevation_gain_m    numeric(8,2),
  avg_hr_bpm          integer,
  max_hr_bpm          integer,
  avg_pace_s_per_km   integer,
  avg_cadence_rpm     integer,
  calories_kcal       integer,
  training_load       numeric(6,2),    -- ATL/CTL compatible score
  rpe                 integer CHECK (rpe BETWEEN 1 AND 10),
  notes               text,
  file_url            text,            -- Supabase Storage path
  raw_data            jsonb,           -- full parsed payload
  created_at          timestamptz DEFAULT now(),
  UNIQUE(user_id, external_id)         -- dedup for future API sources
);
ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users access own activities"
  ON public.activities FOR ALL USING (auth.uid() = user_id);
CREATE INDEX activities_user_started ON public.activities(user_id, started_at DESC);
```

### public.activity_streams
```sql
-- Time-series data points (HR, pace, cadence per second/lap)
CREATE TABLE public.activity_streams (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id uuid REFERENCES public.activities(id) ON DELETE CASCADE NOT NULL,
  user_id     uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  stream_type text NOT NULL,   -- 'heartrate','pace','cadence','altitude','latlng','power'
  data        jsonb NOT NULL,  -- [{t: 0, v: 142}, {t: 1, v: 143}, ...]
  created_at  timestamptz DEFAULT now()
);
ALTER TABLE public.activity_streams ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users access own streams"
  ON public.activity_streams FOR ALL USING (auth.uid() = user_id);
```

### public.training_plans
```sql
CREATE TABLE public.training_plans (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title       text NOT NULL,
  goal        text,
  start_date  date NOT NULL,
  end_date    date NOT NULL,
  status      text DEFAULT 'active' CHECK (status IN ('active','completed','archived')),
  created_at  timestamptz DEFAULT now()
);
ALTER TABLE public.training_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users access own plans"
  ON public.training_plans FOR ALL USING (auth.uid() = user_id);
```

### public.planned_sessions
```sql
CREATE TABLE public.planned_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id         uuid REFERENCES public.training_plans(id) ON DELETE CASCADE NOT NULL,
  user_id         uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  scheduled_date  date NOT NULL,
  sport_type      text NOT NULL,
  session_type    text,        -- 'easy','tempo','long run','intervals','rest','football','gym'
  description     text,
  target_distance_m integer,
  target_duration_s integer,
  target_hr_zone  integer,
  status          text DEFAULT 'pending' CHECK (status IN ('pending','completed','skipped','modified')),
  completed_activity_id uuid REFERENCES public.activities(id),
  ai_notes        text,        -- AI reasoning for this session
  created_at      timestamptz DEFAULT now()
);
ALTER TABLE public.planned_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users access own sessions"
  ON public.planned_sessions FOR ALL USING (auth.uid() = user_id);
```

### public.coaching_messages
```sql
CREATE TABLE public.coaching_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role        text NOT NULL CHECK (role IN ('user','assistant','system')),
  content     text NOT NULL,
  audio_url   text,            -- Supabase Storage path if voice message
  metadata    jsonb,           -- tool calls, referenced activities, etc.
  embedding   vector(1536),    -- pgvector for RAG retrieval
  created_at  timestamptz DEFAULT now()
);
ALTER TABLE public.coaching_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users access own messages"
  ON public.coaching_messages FOR ALL USING (auth.uid() = user_id);
CREATE INDEX coaching_messages_embedding ON public.coaching_messages
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX coaching_messages_user_created ON public.coaching_messages(user_id, created_at DESC);
```

### public.nutrition_logs
```sql
CREATE TABLE public.nutrition_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  logged_at       timestamptz NOT NULL DEFAULT now(),
  meal_type       text,        -- 'breakfast','lunch','dinner','snack','pre-workout','post-workout'
  photo_url       text,
  ai_identified   jsonb,       -- [{name: 'oatmeal', grams: 80, ...}, ...]
  user_corrected  jsonb,       -- user edits to AI identification
  macros          jsonb,       -- {calories: 450, protein_g: 20, carbs_g: 60, fat_g: 12}
  notes           text,
  created_at      timestamptz DEFAULT now()
);
ALTER TABLE public.nutrition_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users access own nutrition"
  ON public.nutrition_logs FOR ALL USING (auth.uid() = user_id);
```

### public.user_settings
```sql
CREATE TABLE public.user_settings (
  user_id         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  ai_provider     text DEFAULT 'openai' CHECK (ai_provider IN ('openai','anthropic','google','mistral')),
  ai_model        text DEFAULT 'gpt-4o',
  -- API key stored encrypted via pgcrypto
  ai_api_key_enc  bytea,
  units           text DEFAULT 'metric' CHECK (units IN ('metric','imperial')),
  language        text DEFAULT 'en',
  timezone        text DEFAULT 'UTC',
  updated_at      timestamptz DEFAULT now()
);
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users access own settings"
  ON public.user_settings FOR ALL USING (auth.uid() = user_id);
```

---

## MCP Server Integration

MCP servers are registered with the Mastra MCPClient and injected into agents at runtime.
They handle open-ended, flexible operations; typed Mastra tools handle schema-bound, performance-critical operations.

### MCP Servers Used

| Server | Package | Purpose |
|---|---|---|
| `supabase-mcp` | `mcp-server-supabase` | Ad-hoc DB queries — open-ended stats, aggregations the user asks in natural language |
| `fetch-mcp` | `mcp-server-fetch` | YouTube search, USDA food lookup, web research for coaching advice |
| `memory-mcp` | `mem0-mcp` | Long-term user preferences, injury history, coaching style preferences |
| `filesystem-mcp` | `mcp-server-filesystem` | Raw uploaded .FIT/.GPX file inspection (dev/debug only, scoped to uploads dir) |

### MCP vs Typed Tool Decision Rule

```
Is the query schema-bound and performance-critical?  → Typed Mastra tool
Is the query open-ended or hitting an external URL?  → MCP server
```

Examples:
- "Calculate training load" → Typed tool (deterministic formula, fast)
- "How many km did I run in March?" → Supabase MCP (ad-hoc SQL)
- "Find a YouTube video on hill repeats" → Fetch MCP (external URL)
- "Remember I prefer morning runs" → Memory MCP (long-term storage)
- "What's the protein in 100g oatmeal?" → Fetch MCP → USDA API

### Kiro IDE MCP Config (`.kiro/settings/mcp.json`)

```json
{
  "mcpServers": {
    "supabase": {
      "command": "uvx",
      "args": ["mcp-server-supabase@latest"],
      "env": {
        "SUPABASE_URL": "${SUPABASE_URL}",
        "SUPABASE_SERVICE_ROLE_KEY": "${SUPABASE_SERVICE_ROLE_KEY}"
      },
      "disabled": false
    },
    "fetch": {
      "command": "uvx",
      "args": ["mcp-server-fetch@latest"],
      "disabled": false
    },
    "memory": {
      "command": "uvx",
      "args": ["mem0-mcp@latest"],
      "env": {
        "MEM0_API_KEY": "${MEM0_API_KEY}"
      },
      "disabled": false
    },
    "filesystem": {
      "command": "uvx",
      "args": ["mcp-server-filesystem@latest", "--root", "./uploads"],
      "disabled": false
    }
  }
}
```

### Runtime MCP Config (in-app, `src/lib/mcp/client.ts`)

```typescript
import { MCPClient } from '@mastra/mcp'

export const mcpClient = new MCPClient({
  servers: {
    supabase: {
      command: 'uvx',
      args: ['mcp-server-supabase@latest'],
      env: {
        SUPABASE_URL: process.env.SUPABASE_URL!,
        SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY!,
      },
    },
    fetch: {
      command: 'uvx',
      args: ['mcp-server-fetch@latest'],
    },
    memory: {
      command: 'uvx',
      args: ['mem0-mcp@latest'],
      env: { MEM0_API_KEY: process.env.MEM0_API_KEY! },
    },
  },
})
```

---

## AI Architecture (Mastra)

### Agents

**CoachAgent** — primary conversational agent
- Tools: `getRecentActivities`, `getTrainingLoad`, `getPlannedSessions`, `searchMemory`, `updatePlan`
- Memory: pgvector-backed, hybrid retrieval (vector + date filter)
- System prompt: athletic coaching persona, aware of user goal and current plan

**PlannerAgent** — training plan generation and updates
- Tools: `getUserProfile`, `getActivityHistory`, `generatePlan`, `updatePlan`
- Triggered by: new user onboarding, explicit "update my plan" requests, post-session analysis

**NutritionAgent** — nutrition photo analysis and advice
- Tools: `identifyFoodFromPhoto`, `lookupMacros`, `getNutritionHistory`, `getUpcomingWorkouts`
- Triggered by: photo upload

### Workflows

**ActivityProcessingWorkflow**
```
Upload file
  → Parse (.FIT/.GPX/.TCX)
  → Normalize to activity schema
  → Calculate training load
  → Store activity + streams
  → Trigger CoachAgent for post-session insight
  → Update training plan (mark session complete)
  → Embed activity summary in vector store
```

**DailyReadinessWorkflow** (scheduled, morning)
```
Get last 7 days activities
  → Calculate ATL (acute training load)
  → Calculate CTL (chronic training load)
  → Compute TSB (training stress balance)
  → Generate readiness score + message
  → Push to dashboard
```

**PlanUpdateWorkflow**
```
User signals fatigue / misses session
  → Assess current training load
  → Re-evaluate remaining plan weeks
  → Adjust session intensity/volume
  → Notify user of changes
```

---

## API Routes

```
POST   /api/auth/[...nextauth]        Supabase Auth handlers
GET    /api/profile                   Get user profile
PUT    /api/profile                   Update user profile

POST   /api/activities/upload         Upload .FIT/.GPX/.TCX file
GET    /api/activities                List activities (paginated, filtered)
GET    /api/activities/[id]           Get single activity with streams
DELETE /api/activities/[id]           Delete activity

POST   /api/ai/chat                   Send message to CoachAgent (streaming)
POST   /api/ai/voice/transcribe       Transcribe audio → text (Whisper)
GET    /api/ai/readiness              Get daily readiness score

GET    /api/plan                      Get active training plan
POST   /api/plan/generate             Generate new training plan
PUT    /api/plan/sessions/[id]        Update planned session status
POST   /api/plan/update               Trigger plan re-evaluation

POST   /api/nutrition/analyze         Analyze nutrition photo
GET    /api/nutrition                 Get nutrition log (date range)
PUT    /api/nutrition/[id]            Update/correct nutrition entry

GET    /api/videos/search             Search YouTube videos
```

---

## Frontend Pages & Components

```
/                           → redirect to /dashboard or /login
/login                      → social login page (Google, Apple, Facebook, Strava)
/onboarding                 → profile setup + goal setting (first login)
/dashboard                  → main view: readiness, today's session, recent activity, chat
/coach                      → full AI coaching chat with voice interface
/plan                       → training plan calendar view
/activities                 → activity list + upload
/activities/[id]            → activity detail: map, charts, AI insight
/nutrition                  → nutrition log + photo capture
/nutrition/[id]             → meal detail + macro breakdown
/settings                   → AI provider config, profile, preferences
```

### Key Components

- `VoiceRecorder` — record audio, visualize waveform, send to transcription
- `ChatInterface` — streaming message display, voice/text toggle
- `ActivityUploader` — drag-and-drop .FIT/.GPX/.TCX, progress indicator
- `TrainingCalendar` — weekly view, session cards, status badges
- `ActivityMap` — Leaflet map with GPS track
- `MetricsChart` — Recharts wrapper for HR/pace/cadence over time
- `ReadinessScore` — gauge component with fatigue indicators
- `NutritionCapture` — camera/upload → AI analysis → editable macro display
- `ProviderSettings` — AI provider selector + encrypted key input + test button
- `VideoSearch` — search input + YouTube embedded results grid

---

## Multi-Tenancy & Security

### RLS Strategy
- Every table has `user_id` column with RLS policy `auth.uid() = user_id`
- No cross-user queries possible at DB level
- API routes validate session server-side before any DB operation
- Supabase Storage uses per-user path prefix: `{user_id}/activities/`, `{user_id}/nutrition/`

### API Key Encryption
```typescript
// Encrypt before storing
const encrypted = await supabase.rpc('encrypt_api_key', { key: rawKey })

// Stored as bytea in user_settings.ai_api_key_enc
// Decrypted server-side only, never returned to client
```

### Environment Secrets
All secrets via environment variables — never hardcoded:
```
SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
OPENAI_API_KEY (system default)
YOUTUBE_API_KEY
USDA_API_KEY
NEXTAUTH_SECRET
```

---

## Local Dev Setup

```yaml
# docker-compose.yml
services:
  app:
    build: .
    ports: ["3000:3000"]
    env_file: .env.local
    volumes:
      - .:/app
      - /app/node_modules
    depends_on: [supabase-db]

  # Supabase self-hosted stack
  supabase-db:
    image: supabase/postgres:15
    ports: ["5432:5432"]
    environment:
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}

  # Additional Supabase services via official docker-compose
  # https://github.com/supabase/supabase/tree/master/docker
```

**Ngrok setup:**
```bash
ngrok http --domain=your-stable-domain.ngrok.io 3000
# Configure OAuth redirect URIs with stable Ngrok domain
```

---

## Deployment (Production)

```
Frontend:  Vercel (auto-deploy from main branch)
Backend:   Vercel serverless (API routes co-located)
Database:  Supabase managed Pro ($25/mo)
Storage:   Supabase Storage (included)
Auth:      Supabase Auth (included)
Domain:    Custom domain on Vercel
```

---

## Phase Roadmap

### Phase 1 — Core Foundation (Weeks 1-3)
Auth, profile, activity upload (.FIT/.GPX/.TCX), activity detail view, basic dashboard

### Phase 2 — AI Coaching (Weeks 4-6)
Mastra agents, voice interface, coaching chat with RAG memory, training plan generation

### Phase 3 — Planning & Adaptation (Weeks 7-8)
Training calendar, readiness score, plan updates on fatigue, post-session AI insights

### Phase 4 — Nutrition & Video (Weeks 9-10)
Nutrition photo logging, macro tracking, YouTube video search and embed

### Phase 5 — Polish & PWA (Weeks 11-12)
Data visualisation improvements, PWA manifest, offline caching, AI provider settings

### Phase 6 — SaaS Prep (Post-marathon)
Multi-tenant UI, billing, Strava/Garmin API integrations, AI gateway
