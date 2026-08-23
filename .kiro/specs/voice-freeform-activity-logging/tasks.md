# Voice & Free-form Activity Logging — Implementation Tasks

> Reuses existing Whisper transcribe route, the `manual` activity source, the Mastra tool pattern
> (`updateSessionStatus` precedent), and the transcribe→edit composer UX. New pieces: an NL parser,
> a parse endpoint, a manual create endpoint, an entry UI, and an optional chat tool.

---

## Phase 1 — Types & shared logic

### Task 1.1 — Draft types
- [ ] Add `ActivityDraft` and `StrengthBlock` interfaces to `app/src/types/activity.ts`.

### Task 1.2 — Draft zod schema + validation
- [ ] Create `app/src/lib/activities/draft-schema.ts` exporting `activityDraftSchema` (zod) with
      required `sportType` + `startedAt` and range checks (rpe 1–10, avg_hr 20–250, etc.).
- [ ] Export a `validateDraft(draft)` helper returning typed errors for the confirm form.

### Task 1.3 — Shared insert helper
- [ ] Create `insertManualActivity(supabase, userId, draft)` in
      `app/src/lib/activities/insert-manual.ts`. Maps draft → `activities` insert with
      `source:'manual'`, `external_id:null`, `file_url:null`, `raw_data:{entry:'freeform',
      transcript, strength}`. Render a readable strength summary into `notes` for RAG. Returns
      `{ id }`. (Mirror the mapping in `upload/route.ts`.)
- [ ] Add `findLikelyDuplicate(supabase, userId, { sportType, startedAt })` — same user + sport +
      `started_at` within ±90 min. Used by the create endpoint (Req 4.5).

---

## Phase 2 — Parsing

### Task 2.1 — NL parser
- [ ] Create `app/src/lib/ai/parse-activity.ts` with `parseActivity(text, { userId, clientNow,
      tz, units })`. Use AI SDK `generateObject` with `activityDraftSchema`; resolve provider/key
      via `resolveUserAISettings` + `resolveModel`.
- [ ] Write the system prompt: supported sports + synonyms, pace/distance/date normalisation,
      "never fabricate unstated metrics", timezone/relative-date handling. When date and/or time
      are absent or vague ("last run"), set `dateTimeNeedsConfirmation=true` and add an assumption
      note rather than silently defaulting.
- [ ] Parse strength into the structured `strength[]` array ({exercise, sets, reps, weightKg}).
- [ ] Add bounded timeout + graceful fallback (low-confidence, partial/empty draft).

### Task 2.2 — Parse endpoint
- [ ] Create `POST /api/activities/parse` (`runtime='nodejs'`): auth → `{text, clientNow, tz}` →
      `parseActivity` → `{ draft }`. No DB write.

---

## Phase 3 — Create endpoint

### Task 3.1 — Manual create
- [ ] Add `POST` to `app/src/app/api/activities/route.ts`: auth → validate via
      `activityDraftSchema` → `findLikelyDuplicate` (unless `force:true`, else return 409 with the
      candidate) → `insertManualActivity` → `{ id }` (201). 400 on validation failure.

---

## Phase 4 — Entry UI

### Task 4.1 — AddActivityByVoice component
- [ ] Create `app/src/components/activities/add-activity-by-voice.tsx` (client) with the three
      states: input (textarea + reused `<VoiceRecorder>`), draft (editable form with assumption
      hints + inline validation), saved (refresh + navigate to `/activities/[id]`).
- [ ] Wire all fetches through `http()`; parse via `/api/activities/parse`, save via
      `POST /api/activities`. Disable Save until date/time is confirmed when
      `dateTimeNeedsConfirmation`; handle `409` with a "Save anyway" (force) action + link to the
      existing activity.
- [ ] Ensure keyboard nav + ARIA labels on voice control, textarea, and form fields.

### Task 4.2 — Surface on Activities page
- [ ] Add an "Add by voice/text" affordance to `app/src/app/(app)/activities/page.tsx` next to
      the existing uploader.

---

## Phase 5 — Chat tool (optional path)

### Task 5.1 — addActivity tool
- [ ] Add `addActivity` tool to `app/src/lib/ai/tools/index.ts` (sibling of
      `updateSessionStatus`). `inputSchema` = draft schema + `confirmed: boolean`.
- [ ] `confirmed:false` → return normalised draft (no write) for read-back; `confirmed:true` →
      call shared `insertManualActivity`. Register the tool in the returned tools object.
- [ ] Update the coach agent instructions (`app/src/lib/ai/agents/coach.ts`) to describe the
      confirm-then-save two-turn flow.

---

## Phase 6 — Verification

### Task 6.1 — Unit tests
- [ ] Test `parseActivity` mapping against the spec's example utterances (mock the model),
      including `dateTimeNeedsConfirmation` on vague/"last run" inputs and `strength[]` parsing.
- [ ] Test `activityDraftSchema` validation (ranges, required fields).
- [ ] Test `insertManualActivity` column mapping + notes strength summary.
- [ ] Test `findLikelyDuplicate` window logic (hit inside ±90 min, miss outside).

### Task 6.2 — Build & manual e2e
- [ ] Run the project build/lint (`npm run build` / `npm run lint` in `app/`).
- [ ] Manual: voice → transcript → draft → edit → save → detail page; and the chat two-turn flow.
