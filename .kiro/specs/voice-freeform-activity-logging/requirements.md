# Voice & Free-form Activity Logging — Requirements

## Overview

Let an athlete add an activity by **speaking** or **typing a free-form sentence** instead of
uploading a file or filling a structured form. The system parses the utterance into a structured
activity draft, shows it back for **confirm / edit**, and only then saves it as a `manual`
activity.

Examples the feature must handle:
- "add my last run which was 10km at 5'14/km with hr 139"
- "add gym session with 2x8 squat"
- "football match yesterday, 90 minutes, felt like an RPE 7"

This extends the existing **Manual Activity Logging** requirement (spec
`sportai-coaching-app` §2.2) with a natural-language entry path. It reuses the existing Whisper
voice route and the existing `manual` activity source — no new activity source is introduced.

---

## Actors

- **Athlete** — speaks or types the activity, reviews the parsed draft, confirms or edits.
- **Parser (LLM)** — converts free text into a structured activity draft.
- **AI Coach (chat)** — optionally offers the same capability as a tool inside the chat.

---

## Requirements

### 1. Free-form Text Entry

- **1.1** MUST provide a single free-text input where the athlete can type a sentence describing
  an activity (e.g. "10k easy run this morning, avg hr 139").
- **1.2** MUST parse the text into a structured **activity draft** with the fields the app already
  stores: `sport_type`, `started_at`, `duration_s`, `distance_m`, `avg_hr_bpm`, `max_hr_bpm`,
  `avg_pace_s_per_km`, `avg_cadence_rpm`, `calories_kcal`, `rpe`, `notes`.
- **1.3** MUST resolve dates/times to a concrete `started_at` in the athlete's local time.
  - Relative dates ("yesterday", "this morning") MUST be resolved against the athlete's local
    clock.
  - When the utterance gives **no explicit date and/or time** — including vague references like
    "my last run" — the system MUST NOT silently default. It MUST flag the date/time as
    **needs-confirmation** in the draft and prompt the athlete to set/confirm the exact date and
    time in the confirm step before saving. This confirmation is what makes reliable dedup
    possible (see §4.5).
  - When an explicit date and time are stated, they MAY be pre-filled as high-confidence.
- **1.4** MUST recognise the supported sport types (`run`, `football`, `gym`, `cycle`, `other`) and
  map synonyms ("jog"→run, "lifting"/"weights"→gym, "soccer"→football, "ride"/"bike"→cycle).
- **1.5** MUST accept both metric and imperial phrasing and normalise to the stored units
  (distance in metres, pace in seconds/km) honouring the user's `units` setting for display.
- **1.6** MUST capture pace expressions like `5'14/km`, `5:14 min/km`, `8:30 min/mile` and convert
  to `avg_pace_s_per_km`.
- **1.7** MUST capture strength details (e.g. "2x8 squat", "3x5 deadlift 80kg") into a
  **structured** representation: an array of `{ exercise, sets, reps, weightKg }` entries stored
  in `raw_data.strength`, PLUS a human-readable summary rendered into `notes` (e.g. "Gym: squat
  2x8, deadlift 3x5 @80kg") so it feeds the existing embedding/RAG retrieval. No new columns are
  required for v1 (structured data lives in the existing `raw_data` jsonb). See design for the
  tradeoff vs a dedicated table.
- **1.8** MUST NOT fabricate metrics that were not stated. Unstated fields MUST be left empty
  (null), not guessed.

### 2. Voice Entry

- **2.1** MUST let the athlete record a spoken sentence and transcribe it via the existing
  `POST /api/ai/voice/transcribe` route (Whisper), reusing the existing `VoiceRecorder` component
  and `useRecorder` hook.
- **2.2** MUST place the transcript into the same free-text input so the flow converges with §1
  (transcribe → text → parse → confirm).
- **2.3** SHOULD let the athlete edit the raw transcript before parsing, matching the existing
  chat composer behaviour where transcripts are editable.
- **2.4** MUST handle transcription failures gracefully with a retry option and never lose the
  audio-derived text silently.

### 3. Confirm / Edit Before Save

- **3.1** MUST present the parsed draft in an editable form before any write. Nothing is persisted
  until the athlete explicitly confirms.
- **3.2** MUST allow the athlete to correct every parsed field (sport, date/time, duration,
  distance, HR, pace, RPE, notes) in that form.
- **3.3** MUST clearly distinguish parsed-with-confidence values from assumed/defaulted values
  (e.g. the defaulted time from §1.3).
- **3.4** MUST validate the edited draft before save: required = `sport_type` + `started_at`;
  numeric fields within sane ranges (e.g. `rpe` 1–10, `avg_hr_bpm` 20–250).
- **3.5** SHOULD let the athlete discard the draft without saving.

### 4. Persistence

- **4.1** MUST persist a confirmed draft as an `activities` row with `source = 'manual'`,
  `external_id = null`, `file_url = null`, and no streams.
- **4.2** MUST scope the insert to the authenticated user (`user_id`), consistent with existing
  routes (`supabase.auth.getUser()` + `.eq('user_id', …)` / RLS).
- **4.3** MUST return the created activity id so the UI can navigate to the activity detail page.
- **4.4** SHOULD store the original utterance/transcript in `raw_data` for future re-parsing and
  auditing.
- **4.5** MUST guard against duplicates before saving. Since manual entries have no `external_id`,
  the system MUST check for an existing activity with the same `user_id`, same `sport_type`, and a
  `started_at` within a small window (e.g. ±90 min) of the confirmed time. If a likely duplicate
  is found, it MUST warn the athlete and require an explicit "save anyway" confirmation rather than
  silently inserting. This is why §1.3 forces date/time confirmation for vague utterances.

### 5. Chat Integration (optional path)

- **5.1** SHOULD expose the same capability inside the AI Coach chat as a tool so the athlete can
  say "add my last run…" mid-conversation.
- **5.2** When invoked from chat, the tool MUST return a **draft** (not an immediate write) so the
  athlete can confirm; the actual save happens only after explicit confirmation. See design for
  how this reconciles with the current plain-text chat stream.
- **5.3** MUST reuse the same parser and the same create endpoint as the direct entry path — no
  duplicated parsing/insert logic.

### 6. Non-functional

- **6.1** Parsing MUST run server-side (LLM key never exposed to the client), reusing
  `resolveUserAISettings` for provider/key selection.
- **6.2** The full flow (speak → transcribe → parse → draft shown) SHOULD complete in a few
  seconds on a typical connection; parsing MUST have a bounded timeout and a graceful failure
  path that falls back to the manual form pre-filled with whatever was parsed.
- **6.3** MUST be accessible: the voice control, the text input, and the confirm form must be
  keyboard-navigable and screen-reader labelled.

---

## Out of Scope (v1)

- New activity source values (reuse `manual`).
- New DB columns for sets/reps (store in `notes`/`raw_data`).
- Editing an activity after it is saved via this flow (handled separately; note there is currently
  no `PATCH /api/activities/[id]`).
- Multi-activity from a single utterance ("add my run and my gym session").
- Non-English voice input (Whisper is pinned to `en`; see the transcribe route decision comment).
