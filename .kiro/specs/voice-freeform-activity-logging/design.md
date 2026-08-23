# Voice & Free-form Activity Logging — Design

## Goal

Turn a spoken or typed sentence ("add my last run, 10km at 5'14/km, hr 139") into a saved
`manual` activity, with a mandatory confirm/edit step in between. Reuse what already exists:
Whisper transcription, the `manual` source, the Mastra tool pattern, and the transcribe→edit
composer UX.

---

## How this fits the existing code

Grounding (files inspected):

- **Activity model** — `app/src/types/database.ts` (`activities` columns, `Activity` interface,
  `SportType`, `ActivitySource` incl. `'manual'`) and `app/src/types/activity.ts`
  (`NormalizedActivity` — the shared camelCase shape all ingestion paths produce).
- **Only creation path today** — `app/src/app/api/activities/upload/route.ts`. Its auth check and
  the `.insert({...})` mapping (camelCase → snake_case) are the template for a manual create.
  `app/src/app/api/activities/route.ts` currently has **only** `GET`.
- **Voice** — `app/src/app/api/ai/voice/transcribe/route.ts` returns `{ text }` (Whisper-1,
  `language=en`). Called from `app/src/components/chat/voice-recorder.tsx` via `useRecorder`
  (`app/src/hooks/use-recorder.ts`); in `chat-interface.tsx` the transcript is appended into the
  composer for review — the exact "transcribe then edit" pattern we reuse.
- **Chat + tools** — `app/src/app/api/ai/chat/route.ts` (Mastra + AI SDK v4, `streamLegacy`,
  **plain-text** stream), `app/src/lib/ai/agents/coach.ts`, and
  `app/src/lib/ai/tools/index.ts` where `updateSessionStatus` is the write-tool precedent
  (zod `inputSchema`, scoped `supabase.from(...).eq('user_id', userId)`).
- **Client fetch** — all client→API calls go through `http()` (`app/src/lib/http.ts`).
- **Auth** — every route: `createClient()` → `supabase.auth.getUser()` → 401 if none.

Two things do **not** exist and must be built: (1) a natural-language → activity parser, and
(2) a manual create endpoint. The chat stream is plain-text only, so it cannot render an
interactive confirm card — this constrains the chat path (see §6).

---

## Architecture

```
Voice ──▶ /api/ai/voice/transcribe ──▶ text
                                         │
Text ────────────────────────────────▶ [ free-text input ]
                                         │
                                         ▼
                          POST /api/activities/parse   (LLM, server-side)
                                         │  returns ActivityDraft (no write)
                                         ▼
                          [ Confirm / Edit draft form ]  ◀── athlete edits
                                         │  confirm
                                         ▼
                          POST /api/activities  (source:'manual')  ──▶ activities row
                                         │
                                         ▼
                              navigate to /activities/[id]
```

The **parse** and the **save** are deliberately separate calls. Parse is read-only and cheap to
retry; save is the only mutation and happens strictly after human confirmation (Requirement 3.1).

---

## Data shapes

### ActivityDraft (new, `app/src/types/activity.ts`)

Superset of the insertable fields plus parse metadata. This is what the parser returns and what
the confirm form binds to.

```ts
export interface ActivityDraft {
  sportType: SportType | null
  startedAt: string | null          // ISO local; null when not stated (Req 1.3)
  dateTimeNeedsConfirmation: boolean // true when date and/or time were absent/vague
  durationS: number | null
  distanceM: number | null
  avgHrBpm: number | null
  maxHrBpm: number | null
  avgPaceSPerKm: number | null
  avgCadenceRpm: number | null
  caloriesKcal: number | null
  rpe: number | null
  notes: string | null
  strength: StrengthBlock[]          // structured sets/reps (Req 1.7); [] when none
  // parse metadata (not persisted as columns)
  assumptions: string[]              // e.g. ["date/time not stated — please confirm"]
  confidence: 'high' | 'low'
  transcript: string                 // the original utterance
}

export interface StrengthBlock {
  exercise: string                   // "squat"
  sets: number | null                // 2
  reps: number | null                // 8
  weightKg: number | null            // 80, or null when bodyweight/unstated
}
```

**Date/time (Req 1.3):** when the utterance omits date and/or time — including "my last run" —
the parser sets `startedAt` to its best guess (or null) and `dateTimeNeedsConfirmation = true`,
adding an assumption note. The confirm form then requires the athlete to set/confirm the exact
date and time before Save is enabled. This is a prerequisite for reliable dedup (see create
endpoint below).

**Strength (Req 1.7):** the structured `strength` array is persisted in `raw_data.strength`, and
`insertManualActivity` also renders a readable summary into `notes` (e.g. "Gym: squat 2x8,
deadlift 3x5 @80kg") so the existing embedding/RAG pipeline can retrieve it.

### Strength storage — chosen approach & tradeoff

We store structured strength data as a JSON **array of objects** in the existing `raw_data` jsonb
column (no migration), plus a text summary in `notes` for retrieval. Rationale vs alternatives:

| Option | Query/aggregation | Retrieval (RAG) | Migration cost |
|---|---|---|---|
| Free text in `notes` only | none | via note embedding | none |
| **`raw_data.strength[]` + notes summary (chosen)** | jsonb operators (adequate) | via note embedding | none |
| Dedicated `strength_sets` table | first-class SQL, PRs, charts | via note embedding | migration + RLS + insert path |

An array of `{exercise, sets, reps, weightKg}` is preferred over a flat map like
`{ squat: "2x8" }` because it handles the same exercise appearing twice, keeps reps/weight as
separate typed values (not a string to re-parse), and preserves order. If per-exercise
progression charts or PR detection become a priority, promote to a `strength_sets` table later and
backfill from `raw_data.strength` — the draft shape stays the same.

---

## Components

### 1. Parser — `app/src/lib/ai/parse-activity.ts` (new)

- Single server-side function `parseActivity(text, opts) : Promise<ActivityDraft>`.
- Uses the AI SDK's `generateObject` (or Mastra structured output) with a **zod schema** matching
  `ActivityDraft`, so the LLM is forced to return valid structured data. Reuses
  `resolveUserAISettings(userId)` + `resolveModel(...)` for provider/key (Requirement 6.1) — same
  helpers the coach agent uses.
- System prompt encodes the rules from Requirements §1: supported sports + synonyms, pace/date
  normalisation, "never fabricate unstated metrics", timezone handling. Receives the athlete's
  local date/time and `units` so relative dates resolve correctly.
- Bounded timeout; on failure returns a low-confidence draft with only trivially-parseable fields
  (or empty), so the UI can still show the manual form (Requirement 6.2).

### 2. Parse endpoint — `POST /api/activities/parse` (new route)

- Auth → read `{ text, clientNow, tz }` → call `parseActivity` → return `{ draft }`.
- No DB write. `runtime = 'nodejs'`.

### 3. Create endpoint — `POST /api/activities` (add to existing route file)

- Add `POST` alongside the existing `GET` in `app/src/app/api/activities/route.ts`.
- Auth, then **server-side zod validation** of the confirmed draft (Requirement 3.4: required
  `sport_type` + `started_at`; ranges for rpe/hr/etc.).
- **Dedup check (Requirement 4.5):** before inserting, query for an existing activity with the
  same `user_id`, same `sport_type`, and `started_at` within ±90 min of the confirmed time.
  Accept a `force?: boolean` in the body — if a match is found and `force` is not set, return
  `409` with the candidate `{ id, started_at }` so the UI can prompt "save anyway". Manual entries
  have no `external_id`, so this time-window heuristic is our dedup (the file-upload path dedups on
  `external_id`, which doesn't apply here).
- Insert mirroring the upload route's mapping block, with `source: 'manual'`, `external_id: null`,
  `file_url: null`, `raw_data: { entry: 'freeform', transcript, strength }`, and the `notes`
  summary from `insertManualActivity`. No streams.
- Return `{ id }` (Requirement 4.3).

### 4. UI — `AddActivityByVoice` (new client component)

Rendered on the Activities page (a "＋ Add by voice/text" affordance next to the existing
`ActivityUploader`). States:

1. **Input** — a textarea + a `<VoiceRecorder onTranscript={appendToInput}/>` (reused). "Parse"
   button calls `/api/activities/parse` via `http()`.
2. **Draft** — an editable form pre-filled from the returned draft; assumptions shown as hints
   (Requirement 3.3), inline validation (3.4). When `dateTimeNeedsConfirmation` is true, the
   date/time field is highlighted and **Save stays disabled until the athlete sets it**
   (Requirement 1.3). "Save" → `POST /api/activities`; "Edit text" → back to step 1;
   "Discard" → reset.
   - On a `409` (likely duplicate, Requirement 4.5), show the matched activity's date and a
     "Save anyway" action that re-POSTs with `force: true`, plus a link to open the existing one.
3. **Saved** — `router.refresh()` + navigate to `/activities/[id]` (mirrors `ActivityUploader`'s
   success handling).

Forms use plain controlled React state (matches the codebase — no react-hook-form). All fetches
go through `http()`.

---

## Chat integration (Requirement 5)

The chat transport streams **plain text only** and cannot render an interactive confirm card
today. So the chat path uses a **two-turn confirmation**, not a live card:

1. Add an `addActivity` Mastra tool in `app/src/lib/ai/tools/index.ts` (sibling of
   `updateSessionStatus`). Its `inputSchema` is the draft zod schema. Crucially it has a
   `confirmed: boolean` field.
2. When the model calls it with `confirmed: false` (the default for a first mention), the tool
   **does not write** — it calls the shared `parseActivity`/validation and returns the normalised
   draft as data. The agent then reads it back to the athlete in prose ("Got it: 10 km run at
   5:14/km, HR 139, this morning — save it?").
3. On the athlete's "yes", the model calls the tool again with `confirmed: true`, which performs
   the insert via the **same create logic** as the endpoint (share a `insertManualActivity()`
   helper so there's one write path — Requirement 5.3).

This keeps a human confirmation step without needing a richer chat protocol. If/when the chat
stream is upgraded to a structured (data) protocol, the tool result could drive an inline card;
that is a future enhancement, not required for v1.

Shared code so nothing is duplicated:
- `parseActivity()` — used by `/api/activities/parse` and the tool.
- `insertManualActivity(supabase, userId, draft)` — used by `POST /api/activities` and the tool's
  confirmed branch.
- `activityDraftSchema` (zod) — used by the parser output, the create endpoint, and the tool.

---

## Error handling

- Transcription failure → surface retry, keep any partial text (Requirement 2.4).
- Parse failure/timeout → fall back to the manual draft form pre-filled with what parsed
  (Requirement 6.2); never block the athlete from logging.
- Validation failure on save → inline field errors; no write.
- Insert failure → readable error, draft preserved so nothing is lost.

---

## Security / correctness notes

- LLM calls are server-side only; keys via `resolveUserAISettings` (Requirement 6.1).
- Treat the transcript/utterance as untrusted text — it only ever becomes structured data through
  the zod-validated parser; the create endpoint re-validates regardless of source.
- All inserts scoped to `user_id` + RLS, consistent with existing routes.
- `raw_data` stores the transcript for auditing/re-parse; avoid storing anything sensitive beyond
  what the user dictated.

---

## Testing strategy

- Unit-test `parseActivity` prompt/schema against the example utterances (run w/ pace+HR, gym
  sets/reps, football duration+RPE, relative dates) with a mocked model returning fixed objects,
  asserting the mapping/normalisation (pace `5'14/km` → 314 s/km; "yesterday" → correct ISO).
- Unit-test `activityDraftSchema` validation (ranges, required fields).
- Unit-test `insertManualActivity` mapping (source/external_id/file_url, snake_case columns).
- Manual/e2e: voice → transcript → draft → edit → save → detail page.
