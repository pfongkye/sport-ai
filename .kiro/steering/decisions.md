# Settled decisions (always applies — do NOT re-litigate)

These are choices the user has already made. Respect them. If you believe a different
approach is technically "better", that is NOT a reason to change it — STOP and ASK the user
first. Re-deriving these from first principles each session and silently flipping them wastes
the user's time and erodes trust.

## Voice transcription: `/audio/transcriptions` + `language` hint (NOT `/audio/translations`)
- Endpoint: OpenAI `/audio/transcriptions`, with `language: 'en'` for now.
- The `language` value is a spoken-language HINT (fixes mis-detection on short/accented
  clips). Text is kept in the language spoken — we do NOT translate.
- Do NOT switch to `/audio/translations` (force-English output). This has been decided
  multiple times.
- i18n is planned for later; at that point the hint comes from `user_settings.language`.
- File: `app/src/app/api/ai/voice/transcribe/route.ts`

## Language: English-only for now, i18n deferred
- Build UI/content in English. Full i18n is a later version — don't add i18n scaffolding now,
  but don't hardcode assumptions that make i18n hard either.

## AI tooling: typed Mastra tools only, no MCP in the app runtime
- The CoachAgent uses typed tools; MCP is intentionally not wired into the app (can't run on
  Vercel; security). See AGENTS.md gotcha #20. Revisit only via remote HTTP MCP if truly needed.

## Voice/audio retention: transcript-only
- Transcribe then DISCARD audio; store only the transcript. Do not persist recordings by
  default (cost + privacy). Audio storage is a future opt-in, everything for it already exists.

## Coach memory: pgvector HYBRID search (NOT pure/naive RAG, NOT an external vector DB)
- Long-term memory lives in our own Postgres via pgvector — the `coaching_messages` table
  (chat, insights, session notes) with an `embedding vector(1536)` column. No mem0, no
  Pinecone/Weaviate, no separate vector service.
- Retrieval is HYBRID, never vector-similarity alone: combine embedding similarity WITH
  structured filters/signals (recency/date window, `metadata.kind`, `activity_id`, and the
  typed tools that fetch exact recent data). Pure semantic RAG over everything is explicitly
  rejected — it hallucinates relevance, ignores recency, and misses exact numbers the typed
  tools already provide accurately.
- The typed tools (getRecentActivities, getTrainingLoad, getPlannedSessions, getUserProfile)
  remain the source of truth for precise/current facts. RAG only adds SUBJECTIVE / historical
  context (e.g. "last time on this route your calf was tight") on top — it does not replace
  the tools.
- SQL: use `search_coaching_messages` (migration 005) — vector cosine + date filter — and
  cap K (~5). Embed on write with `text-embedding-3-small` (1536-dim, matches schema).
- Files: `supabase/migrations/005_coaching.sql`, chat route, Tasks 2.9/2.10.

## Durable facts: the user can EXPLICITLY remove any remembered fact
- `athlete_facts` (Task 2.10) holds long-term facts ("prefers morning runs", "left calf
  tightness", "no gym Mondays"). The athlete MUST be able to remove/forget any fact directly
  and unambiguously — not only via AI-inferred deactivation.
- Two removal paths, both first-class:
  1. UI: a "What your coach remembers" list in Settings, each fact with a Remove control.
  2. Conversational: "forget that / that's not true anymore" → coach calls a `dismissFact`
     tool. The AI is a convenience, NOT the only way — the UI path never depends on the AI.
- Removal = soft-dismiss (`active=false`) with a reason/timestamp, not hard-delete: keeps an
  audit trail AND lets the extractor treat a dismissed fact as a negative signal so it is not
  silently re-inferred next session. (A true hard-delete is offered too for GDPR/erasure.)
- Removed/dismissed facts are excluded from the system-prompt "Durable facts" layer.
- Why: facts expire (injuries heal, preferences change); a memory that only accumulates
  becomes wrong and erodes trust. User agency over their own remembered data is required.
- Files: `athlete_facts` migration, Task 2.10, Settings memory editor, `dismissFact` tool.

---
When adding a new settled decision here, keep it short: what was decided + the one-line why +
the file(s) it touches.
