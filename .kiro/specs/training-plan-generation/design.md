# Training Plan Generation & Adaptation — Design

## Goal

Generate a schema-valid, periodized training plan (`training_plans` + `planned_sessions`) from the
athlete's goal, availability, readiness, and history — via a deterministic workflow with one
structured LLM call — then view it and adapt future sessions. Reuse existing infra:
`computeReadiness`, `resolveUserAISettings`/`resolveModel`, the tool/agent pattern, and the auth
pattern.

---

## Grounding (existing code)

- **Schema** (`app/src/types/database.ts`): `training_plans` (title, goal, start_date, end_date,
  status: 'active'|'completed'|'archived') and `planned_sessions` (plan_id, user_id,
  scheduled_date, sport_type, session_type, description, target_distance_m, target_duration_s,
  target_hr_zone, status: 'pending'|'completed'|'skipped'|'modified', completed_activity_id,
  ai_notes). No ORM — Supabase client, hand-typed.
- **Readiness** (`app/src/lib/ai/readiness.ts`): `computeReadiness(supabase, userId)` → ATL/CTL/TSB
  + score, with a sparse-data guard. Feed this into generation as the fatigue/fitness signal.
- **AI infra**: `resolveUserAISettings` + exported `resolveModel` (`lib/ai/provider.ts`);
  `generateObject` already used by `parse-activity.ts` — same approach here.
- **Tools**: `getPlannedSessions` (reads sessions), `updateSessionStatus` (write). New tools slot
  into `buildCoachTools` (`lib/ai/tools/index.ts`).
- **Plan page** (`app/src/app/(app)/plan/page.tsx`): a stub to replace.
- **Empty `lib/ai/workflows/`**: the intended home for this workflow (currently unused).

---

## Architecture

```
Trigger: /plan page button  OR  chat generatePlan tool  OR  POST /api/plan/generate
   │
   ▼
generateTrainingPlan(supabase, userId, opts)      ← lib/ai/workflows/generate-plan.ts
   │  1. gather context (deterministic):
   │       profile, goal+date, training_days, computeReadiness, recent activities summary
   │  2. compute the skeleton (deterministic):
   │       #weeks to goal, weekly structure slots, taper window, weekly volume ramp (≤~10%/wk)
   │  3. one structured LLM call:
   │       generateObject({ schema: planSchema, system: periodization rules, prompt: context })
   │  4. validate (zod) + guardrails (dates within window, volume ramp, rest days present)
   │  5. persist: archive old active plan → insert training_plans → insert planned_sessions
   ▼
{ planId, sessionCount }  → UI refresh / chat summary
```

Design choice: the **skeleton math is deterministic** (weeks, dates, taper, volume caps) and the
**LLM fills the qualitative content** (session types, descriptions, HR zones, distribution) inside
those constraints. This keeps output valid and cheap and prevents the model from inventing an
unsafe ramp or scheduling past the goal date.

---

## Data shapes

`app/src/lib/ai/workflows/plan-schema.ts` (zod, drives `generateObject`):

```ts
const plannedSessionSchema = z.object({
  scheduledDate: z.string(),                 // ISO date within [start,end]
  sportType: z.enum(['run','football','gym','cycle','other']),
  sessionType: z.string(),                   // 'easy'|'tempo'|'long run'|'intervals'|'rest'|...
  description: z.string(),
  targetDistanceM: z.number().nullable(),
  targetDurationS: z.number().nullable(),
  targetHrZone: z.number().int().min(1).max(5).nullable(),
})

const planSchema = z.object({
  title: z.string(),
  goal: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  sessions: z.array(plannedSessionSchema).min(1).max(400),
})
```

Maps 1:1 to the insert columns (`targetDistanceM`→`target_distance_m`, etc.).

---

## Components

1. **`lib/ai/workflows/generate-plan.ts`** — `generateTrainingPlan(supabase, userId, opts)`:
   context gathering, skeleton computation, `generateObject`, validation/guardrails, persistence
   (archive-then-insert; insert `training_plans` and `planned_sessions`; on any failure don't leave
   an empty plan — insert sessions first into memory, validate, then write plan + sessions, cleaning
   up the plan row if session insert fails). Returns `{ planId, sessionCount }`.

2. **`lib/ai/workflows/plan-schema.ts`** — zod schemas above + a `planToRows(plan, userId, planId)`
   mapper.

3. **`POST /api/plan/generate`** — auth → `generateTrainingPlan` → `{ planId, sessionCount }`.
   `runtime='nodejs'`, bounded `maxDuration`.

4. **`GET /api/plan`** (or server-component read) — active plan + its sessions for the view.

5. **`/plan` page + `PlanView` client component** — replace the stub: week-grouped list/calendar,
   session cards with target + status, "Generate plan" CTA when none active.

6. **Chat tools** in `buildCoachTools`:
   - `generatePlan` — confirm intent, call the SAME workflow, return a short summary (not every
     session). Two-step confirm like `addActivity` (Req 4.2).
   - **Adaptation** reuses `updateSessionStatus` (exists) plus a new `adjustUpcomingSessions` tool
     that only edits FUTURE `pending` sessions (Req 3.3).

7. **Activity auto-link (Req 3.4)** — in the shared `insertManualActivity` path (and, later, file
   upload), after inserting an activity, look for a same-day + same-sport `pending` planned session
   and set it `completed` + `completed_activity_id`. Best-effort, non-fatal.

---

## Does this impact the data-stream protocol tasks (chat-interactive-tool-ui spec)?

Short answer: **mostly independent, with one deliberate ordering choice and one shared-pattern
opportunity.** Details:

- **No hard dependency, no conflict.** Plan generation's primary surface is the `/plan` page +
  `POST /api/plan/generate`. Viewing/generating a plan does not require the chat transport change at
  all. The two features touch different routes (`/api/plan/*` vs `/api/ai/chat`) and different UI.

- **Shared file: `lib/ai/tools/index.ts`.** Both specs add tools here (`generatePlan`/
  `adjustUpcomingSessions` here; the data-stream spec renders `addActivity`). These are additive and
  don't collide, but expect small merge-adjacent edits in the same file if both are in flight. Low
  risk; just coordinate.

- **The `generatePlan` chat tool wants a card too.** A plan summary is a perfect candidate for an
  interactive card (show the week structure, "looks good / regenerate" buttons) — exactly the
  mechanism the data-stream spec builds. So:
  - If the data-stream upgrade lands FIRST, `generatePlan` can render a rich confirm/summary card
    for near-zero extra cost (reuse the card-rendering path; register a plan card).
  - If plan generation lands first, its chat tool falls back to the current **prose** two-turn
    confirm (same pattern as `addActivity` today) — fully functional, just text. No rework needed
    when the transport later upgrades; you'd only ADD a card renderer.
  - Recommended order: **data-stream first**, then plan generation gets the nicer chat UX for free.
    But plan generation does NOT block on it — build the page-driven flow regardless.

- **Persistence note.** The data-stream spec changes how assistant chat messages persist
  (`onFinish`). Plan generation writes to `training_plans`/`planned_sessions`, not
  `coaching_messages`, so there is no persistence overlap. The only touchpoint is if `generatePlan`
  runs inside a chat turn — in which case it behaves like any other tool call under whichever
  transport is active at the time.

Net: sequence-flexible. Keep the plan workflow + `/api/plan/*` + `/plan` page free of any chat-
transport assumptions, and treat the `generatePlan` card as an optional enhancement gated on the
data-stream work.

---

## Things to be careful of

1. **Empty-plan integrity (Req 5.2).** Never leave a `training_plans` row with zero sessions.
   Validate the full session set in memory first; write the plan, then sessions; if session insert
   fails, delete the plan row. (No multi-statement transaction over the JS client, so do
   application-level cleanup.)
2. **Regeneration duplication (Req 1.7).** Archive the existing active plan before inserting a new
   one; enforce single-active in code (and ideally a partial unique index later).
3. **Date/timezone.** `scheduled_date` is a date (no time). Compute the window in the athlete's
   timezone (`user_settings.timezone`) so "start next Monday" and taper land correctly.
4. **Model over-scheduling.** Guardrails must reject sessions outside [start,end], missing rest
   days, or >~10%/week volume jumps — don't trust the LLM to self-limit.
5. **Adaptation scope (Req 3.3).** `adjustUpcomingSessions` must filter `scheduled_date >= today AND
   status='pending'`; never touch completed/past rows.
6. **Cost/latency.** One `generateObject` call, but a long marathon block is many sessions → large
   output. Bound tokens, set a timeout, and consider generating week-by-week if output size is a
   problem (deterministic loop, still one schema per week).
7. **Reuse, don't fork.** The chat `generatePlan` tool and `POST /api/plan/generate` MUST call the
   same `generateTrainingPlan` function.

---

## Testing strategy

- Unit: skeleton math (weeks-to-goal, taper window, weekly volume caps) — pure, deterministic.
- Unit: `planToRows` mapping + guardrail validators (reject out-of-window dates, unsafe ramp).
- Integration: mock `generateObject` returning a fixed plan; assert archive-old + insert plan +
  insert sessions, and cleanup on simulated session-insert failure.
- Unit: activity auto-link sets the matching pending session completed.
- Manual: generate a marathon plan, view calendar, complete a session via a logged activity, run an
  adaptation after a missed week.
