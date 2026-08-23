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

- **2.1** MUST replace the `/plan` stub with a view listing the active plan and its sessions
  (calendar or grouped-by-week list), reading from `planned_sessions`.
- **2.2** MUST show each session's type, target, and status; completed sessions link to the
  activity (`completed_activity_id`).
- **2.3** SHOULD let the athlete trigger generation from this page when no active plan exists.

### 3. Plan lifecycle & adaptation

- **3.1** MUST support a single active plan per user (others `archived`/`completed`).
- **3.2** SHOULD adapt the plan when reality diverges: missed sessions, low readiness, or a new
  activity that completes/replaces a planned session.
- **3.3** Adaptation MUST only modify FUTURE `pending` sessions — never rewrite past/completed ones.
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
- **5.3** MUST be accessible (plan view keyboard-navigable, screen-reader labelled).

---

## Out of Scope (v1)

- Multi-sport concurrent periodization beyond the athlete's stated prefs (keep running-goal-first).
- Editing individual sessions by hand in the UI (adaptation is AI-driven for v1; manual edit later).
- Calendar drag-and-drop.
- Notifications/reminders.
