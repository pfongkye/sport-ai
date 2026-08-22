# SportAI Coaching App — Requirements

## Overview

A personal AI coaching platform for multi-sport athletes (running, football, gym) that tracks
performance, provides intelligent coaching, manages training plans, and adapts to current
fitness and fatigue levels. Built for personal use first, architected for SaaS from day one.

Primary goal for v1: Support a marathon training plan targeting 3h30 in November, with
voice-first AI interaction and persistent coaching memory.

---

## Actors

- **Athlete (primary user)**: The person training, logging sessions, and interacting with AI coach
- **System**: Background jobs, AI agents, data processors
- **External services**: Strava, file upload pipeline, YouTube, food APIs, AI providers

---

## Requirements

### 1. Authentication & Multi-Tenancy

#### 1.1 Social Login
- MUST support login via Google OAuth
- MUST support login via Apple OAuth
- MUST support login via Facebook OAuth
- MUST support login via Strava OAuth (doubles as data connection)
- MUST isolate all user data by tenant using Row Level Security (RLS)
- MUST support user account deletion with full data purge

#### 1.2 User Profile
- MUST store athlete profile: name, avatar, date of birth, weight, height
- MUST store sport preferences (running, football, gym, cycling, etc.)
- MUST store primary goal (e.g., "Marathon 3h30, November 2026")
- SHOULD store training availability (days/week, preferred times)

---

### 2. Activity Ingestion

#### 2.1 File Upload
- MUST support .FIT file upload (primary format for Coros/Garmin)
- MUST support .GPX file upload
- MUST support .TCX file upload
- MUST parse and normalize all formats into a unified activity schema
- MUST preserve raw parsed data (jsonb) for future reprocessing
- MUST deduplicate uploads (same activity uploaded twice = one record)
- MUST handle upload errors gracefully with user feedback

#### 2.2 Manual Activity Logging
- MUST allow manual entry for activities without a file (football, gym)
- MUST support: sport type, date, duration, distance (optional), notes, RPE (1-10)
- SHOULD support sets/reps logging for gym sessions

#### 2.3 Activity Schema (normalized)
- Activity must store: id, user_id, source, external_id, sport_type, started_at,
  duration_s, distance_m, elevation_gain_m, avg_hr_bpm, max_hr_bpm, avg_pace_s_per_km,
  avg_cadence_rpm, calories_kcal, training_load, raw_data (jsonb), notes, created_at
- Source values: `upload_fit`, `upload_gpx`, `upload_tcx`, `strava`, `garmin`, `coros`, `manual`

#### 2.4 Future API Integrations (deferred, architecture must support)
- Strava API (OAuth, webhook push)
- Garmin Connect API (OAuth, webhook push)
- Coros Open API (OAuth)

---

### 3. AI Coaching

#### 3.1 Voice Interface
- MUST support voice input (record audio → transcribe via Whisper API)
- MUST support voice output (AI response read aloud via TTS)
- MUST allow text fallback for all voice interactions
- MUST support natural language commands: "How was my run yesterday?", "Plan my week", "I'm feeling tired today"

#### 3.2 Coaching Chat
- MUST maintain a persistent conversation thread per user
- MUST have access to full activity history when generating responses
- MUST provide reactive insights: analysis of completed sessions
- MUST provide proactive coaching: recommendations for upcoming sessions
- MUST acknowledge fatigue/illness signals from user input
- SHOULD reference specific past sessions by date or name

#### 3.3 Memory & RAG
- MUST store all coaching conversations in vector store (pgvector)
- MUST retrieve relevant past context when answering queries
- MUST use hybrid search (vector similarity + date/keyword filters)
- MUST summarize long-term patterns (e.g., weekly training load trends)
- SHOULD remember user preferences and coaching style over time

#### 3.4 Training Plan
- MUST generate a structured training plan based on goal, current fitness, and timeline
- MUST update plan dynamically when user reports fatigue or missed sessions
- MUST display plan as a weekly calendar view
- MUST mark sessions as completed, skipped, or modified
- SHOULD adjust plan after each completed session based on actual vs planned load
- SHOULD provide daily readiness score based on recent training load and rest

#### 3.5 AI Provider Configuration
- MUST allow user to configure their own AI provider API key (OpenAI, Anthropic, Google Gemini, Mistral)
- MUST store API keys encrypted (never in plaintext)
- MUST provide a "Test Connection" feature before saving
- MUST fall back to system default provider if user key is not set
- SHOULD display estimated token usage/cost per session

---

### 4. Nutrition

#### 4.1 Photo Logging
- MUST allow user to photograph a meal for logging
- MUST use AI Vision (OpenAI Vision API) to identify food items in photo
- MUST look up macros via USDA FoodData API or Nutritionix after identification
- MUST store: date, photo URL, identified foods, estimated macros (protein/carbs/fat/calories)
- MUST allow user to edit/correct AI identification

#### 4.2 Nutrition Insights
- SHOULD provide daily macro summary
- SHOULD give contextual advice (e.g., "You have a long run tomorrow — consider increasing carbs today")
- SHOULD flag under-fueling relative to training load

---

### 5. Video Advice

#### 5.1 YouTube Integration
- MUST allow user to search for exercise/technique videos via natural language
- MUST use YouTube Data API v3 to fetch results
- MUST display embedded video player in-app
- SHOULD allow AI to proactively suggest videos based on identified weaknesses or upcoming sessions

---

### 6. Data Visualisation

#### 6.1 Dashboard
- MUST display recent activity feed
- MUST display weekly/monthly training load chart
- MUST display pace/HR trends over time
- MUST display current training plan week at a glance
- SHOULD display readiness/fatigue score
- SHOULD display progress toward primary goal (marathon pace trends)

#### 6.2 Activity Detail
- MUST display GPS map for activities with location data
- MUST display HR, pace, cadence charts over time
- MUST display lap splits
- SHOULD display elevation profile

---

### 7. Storage

#### 7.1 Files
- MUST store uploaded .FIT/.GPX/.TCX files in object storage (Supabase Storage)
- MUST store nutrition photos in object storage
- MUST store voice audio recordings in object storage
- MUST enforce per-user storage quotas (configurable)

---

### 8. Non-Functional Requirements

#### 8.1 Security
- MUST use RLS on all Postgres tables — every query scoped to authenticated user
- MUST encrypt sensitive fields (API keys) at rest
- MUST use HTTPS everywhere (enforced via Ngrok/Vercel in all environments)
- MUST not expose one user's data to another under any circumstances
- MUST comply with GDPR basics: data export and deletion on request

#### 8.2 Performance
- File upload parsing MUST complete within 10 seconds for typical .FIT files
- AI chat responses SHOULD stream (not wait for full completion)
- Dashboard SHOULD load in under 2 seconds

#### 8.3 Offline / PWA
- SHOULD work as a PWA (installable on Android home screen)
- SHOULD cache dashboard and recent activities for offline viewing
- SHOULD queue voice notes and uploads when offline, sync on reconnect

#### 8.4 Deployment
- MUST run fully in Docker Compose for local development
- MUST expose local app via Ngrok for mobile testing
- MUST use environment variables for all secrets and config
- SHOULD deploy to Vercel + Supabase managed for production

---

## Out of Scope (v1)

- Real-time BLE wearable connection
- Sleep tracking
- Native Android/iOS app (PWA first)
- AI Gateway (Portkey/Cloudflare) — deferred to Phase 3
- Strava/Garmin/Coros direct API sync — deferred, architecture supports it
- Team/coach portal
- Social features (following other athletes)
- Payment / subscription management
