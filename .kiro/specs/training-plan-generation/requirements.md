# Training Plan Generation & Adaptation — Requirements

## Overview

Generate a structured, multi-week training plan toward the athlete's goal (v1 target: marathon
3h30 in November) and let it adapt as reality diverges from the plan. The plan materialises as
`training_plans` + `planned_sessions` rows the athlete can view on a calendar and that the coach
chat already reads (`getPlannedSessions`).

This closes the biggest gap between the stated v1 goal and what exists: the `/plan` page is a stub
("coming in Phase 3"), the tables exist, and the chat can already read planned sessions but nothing
creates them.

## Design stance (why a workflow, not a free-roaming agent)

Plan output is **schema-bound** (dated sessions with typed targets). So generation is a
**deterministic workflow** that gathers context (profile, goal, readiness, recent load) and makes a
**single structured LLM call** (`generateObject` against a zod schema), then validates and writes
rows. This gives predictable cost, testability, and valid output — versus a multi-turn agent that
could wander. The existing strategy note (`tasks.md`: "Mastra typed tools for schema-bound ops,
agent for flexible ops") supports this.

---

## Requirements

### 1. Plan generation

- **1.1** MUST generate a plan from: primary goal, goal date, sport preferences, training
  availability (`profiles.training_days`), current readiness (ATL/CTL/TSB via `computeReadiness`),
  and recent training history.
- **1.2** MUST produce a `training_plans` row (title, goal, start_date, end_date, status='active')
  and a set of `planned_sessions` rows spanning the plan window.
- **1.3** Each planned session MUST populate the real columns: `scheduled_date`, `sport_type`,
  `session_type`, `description`, `target_distance_m`, `target_duration_s`, `target_hr_zone`,
  `status='pending'`.
- **1.4** MUST respect availability: only schedule on the athlete's training days (or explain when
  it deviates), and MUST include rest/recovery days.
- **1.5** MUST apply sound periodization (progressive overload, a weekly long run for endurance
  goals, taper before the goal date) rather than a flat repeated week.
- **1.6** MUST NOT prescribe unsafe jumps (respect ~10%/week volume progression as a guardrail).
- **1.7** MUST be idempotent per generation: regenerating replaces/supersedes the prior active plan
  rather than silently duplicating (archive the old plan; see 3.x).
- **1.8** MUST run server-side with the user's provider/key (`resolveUserAISettings`), consistent
  with the rest of the AI layer.

### 2. Plan viewing

- **2.1** MUST replace the `/plan` stub with a **week-grouped calendar view** of the active plan and
  its sessions, reading from `planned_sessions`. Sessions MUST be organised by week, with each day's
  session(s) shown in its day slot so the athlete can see the week at a glance. The view MUST be
  **mobile-first**: on a phone it reflows to a readable single-week/single-column layout (no
  horizontal scroll, no clipped day cells) and scales up to a wider multi-column week grid on larger
  screens. Phone is the primary target.
- **2.2** MUST show each session's type, target, and status; completed sessions link to the
  activity (`completed_activity_id`).
- **2.3** SHOULD let the athlete trigger generation from this page when no active plan exists.

### 2a. Manual rescheduling (moving sessions within the week)

- **2a.1** MUST let the athlete **move a planned session to a different date** directly in the UI to
  accommodate real-life adjustments during the week, via a keyboard-accessible "reschedule to date"
  control (v1 baseline). Drag-and-drop is a later enhancement, NOT required for v1.
- **2a.2** Rescheduling MUST only be allowed for **future, editable (pending or rescheduled-and-not-yet-completed)** sessions (same guardrail as
  AI adaptation, Req 3.3) — the athlete MUST NOT be able to move past or completed sessions.
- **2a.3** Rescheduling MUST write only the session's `scheduled_date` (and, where appropriate, set
  `status='modified'` / an `ai_notes` trace that it was manually moved); it MUST NOT alter the
  session's training targets.
- **2a.4** Rescheduling MUST be `user_id`/RLS-scoped and go through an API route (or server action)
  that re-validates the future-and-editable guardrail server-side — never trust the client alone.
- **2a.5** The reschedule control MUST be accessible AND **mobile-first**: operable by keyboard with
  clear labels and a screen-reader confirmation of the new date, AND touch-friendly on a phone
  (adequate hit targets, no hover-only affordance per gotcha #23). The lightweight date control is
  chosen partly because it works cleanly on touch; drag-and-drop (deferred) would need separate
  touch handling.

### 3. Plan lifecycle & adaptation

- **3.1** MUST support a single active plan per user (others `archived`/`completed`).
- **3.2** SHOULD adapt the plan when reality diverges: missed sessions, low readiness, or a new
  activity that completes/replaces a planned session.
- **3.3** Adaptation MUST only modify FUTURE, editable (`pending` or rescheduled `modified`, no completed activity) sessions — never rewrite past/completed ones.
- **3.4** SHOULD auto-link a logged activity to a matching planned session (same day + sport) and
  set that session `completed` (this is the natural tie-in with the manual/voice activity feature).
- **3.5** MUST keep the existing `updateSessionStatus` tool working (the coach marks sessions
  completed/skipped/modified in chat).

### 4. Chat integration

- **4.1** SHOULD let the athlete request a plan in chat ("build me a marathon plan for November")
  via a `generatePlan` tool that triggers the SAME workflow (no duplicated logic).
- **4.2** Because generation writes many rows and takes real time, the chat tool MUST confirm intent
  before generating, and summarise the result rather than dumping every session.

### 5. Non-functional

- **5.1** Generation MUST have a bounded timeout and a graceful failure path (partial/invalid plan
  is rejected, not written).
- **5.2** All writes scoped to `user_id` (+ RLS). Session inserts MUST be transactional-ish: don't
  leave a `training_plans` row with zero sessions on partial failure (clean up or insert plan last).
- **5.3** MUST be accessible (plan view keyboard-navigable, screen-reader labelled) AND
  **mobile-first** — the plan/calendar is designed for a phone screen first and scales up; verify on
  a mobile viewport before considering a UI task done.

### 6. Training recap (deterministic history analysis)
- **6.1** MUST compute a deterministic recap of the athlete's last 6 complete Monday-based weeks
  (athlete timezone = the browser zone, see design point 3; the current partial week is not counted) with a pure function
  `computeTrainingRecap(activities, profile, today)`: same inputs give the same output, no LLM, no
  randomness, no clock reads inside.
- **6.2** A week is a *qualifying week* only with at least `MIN_ACTIVITIES_PER_WEEK` (2) activities
  of any sport. Other weeks MUST be listed as excluded with the reason (e.g. "1 activity", "no
  activity"). The 4 most recent weeks weigh `RECENT_WEIGHT` and the 2 older ones `OLDER_WEIGHT`.
- **6.3** The recap MUST report, per qualifying week: run count, run km, longest run, distance-weighted
  average pace, average HR, total training load, and non-run sport sessions/hours. Overall: typical
  easy pace, typical long run (distance, pace), intensity split (easy/moderate/hard as a share of max
  HR; max HR from the data, else 220 minus age, else unknown), a per-run label (long / easy / tempo /
  hard, from the athlete's own distribution), runs per week, layoff gaps and a recent-vs-older trend.
  Missing data stays `null` and is reported in a `dataQuality` section (missing HR share, missing
  pace share, no-distance share). Nothing is guessed. Intervals are not detected from streams.
- **6.4** The skeleton baseline MUST come from the qualifying weeks (weighted mean, with a week capped
  at `OUTLIER_CAP_FACTOR` x the median week when there are enough weeks). With fewer than
  `MIN_QUALIFYING_WEEKS` qualifying weeks the baseline falls back to a value scaled by the athlete's
  training days (`KM_PER_TRAINING_DAY`, clamped), never above the observed weekly average, and the
  recap tells the model history is sparse so it stays conservative. The flat 15 km floor is gone.
- **6.5** The recap MUST reach the model as one delimited block in the user prompt (replacing the
  per-sport total line). Hard rules, guardrails, repair and the single retry are unchanged.
- **6.6** After validation, run sessions with a distance MUST get `targetDurationS` from distance x the
  athlete's easy / long / tempo pace when that pace is known (else the model's value stays), and sessions
  with an HR zone MUST get the bpm range from max HR (appended to the description) when max HR is known.
- **6.7** The plan page MUST show a compact, mobile-first "What your plan is based on" section (weeks
  included/excluded with reasons, weekly km, easy pace, long run, intensity split, data-quality
  notes), collapsed by default on phones with an accessible expand control; English, metric.
- **6.8** A snapshot of the recap (with `schemaVersion`) MUST be stored in the nullable
  `training_plans.recap` jsonb column (migration 016) in the same insert as the plan, and returned by
  `GET /api/plan` and `loadActivePlan`. Plans created earlier have `recap = null` and show "not available".
- **6.9** The `generatePlan` coach tool result SHOULD mention the key recap facts briefly.
- **6.10** Every tunable constant (weights, thresholds, fallback formula, outlier cap) MUST be a named,
  exported, documented constant covered by tests.

---

## Out of Scope (v1)

- Multi-sport concurrent periodization beyond the athlete's stated prefs (keep running-goal-first).
- Editing a session's **training content** by hand in the UI — type, distance, duration, HR zone
  (content adaptation is AI-driven for v1; manual content edit later). NOTE: manually moving a
  session to a different **date** IS in scope for v1 (Req 2a) — only content editing is deferred.
- **Calendar drag-and-drop** (the v1 reschedule uses a keyboard-accessible date control; drag-and-
  drop is a later enhancement — Req 2a.1).
- Notifications/reminders.
