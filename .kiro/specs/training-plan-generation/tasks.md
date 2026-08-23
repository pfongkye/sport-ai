# Training Plan Generation & Adaptation — Implementation Tasks

> Deterministic workflow + one structured LLM call → writes training_plans + planned_sessions.
> Reuses computeReadiness, resolveUserAISettings/resolveModel, generateObject, the tool pattern,
> and the auth pattern. Sequence-flexible vs the chat data-stream spec (see design §"impact").

---

## Phase 1 — Workflow core

### Task 1.1 — Plan schema + row mapper
- [ ] Create `app/src/lib/ai/workflows/plan-schema.ts`: `plannedSessionSchema`, `planSchema` (zod),
      and `planToRows(plan, userId, planId)` → planned_sessions inserts (camel→snake).

### Task 1.2 — Skeleton math (deterministic, pure)
- [ ] Create `app/src/lib/ai/workflows/plan-skeleton.ts`: weeks-to-goal, weekly slots from
      `training_days`, taper window, weekly volume ramp cap (~10%/wk). No LLM. Unit-testable.

### Task 1.3 — Generation workflow
- [ ] Create `app/src/lib/ai/workflows/generate-plan.ts` `generateTrainingPlan(supabase, userId, opts)`:
      gather context (profile, goal, readiness, recent activity summary) → skeleton → `generateObject`
      with periodization system prompt → validate + guardrails → persist.
- [ ] Persistence: archive existing active plan; insert `training_plans`; insert `planned_sessions`;
      on session-insert failure delete the plan row (no empty plans). Return `{ planId, sessionCount }`.
- [ ] Bounded timeout + graceful failure (reject invalid plan, write nothing).

---

## Phase 2 — API

### Task 2.1 — Generate endpoint
- [ ] `POST /api/plan/generate` (`runtime='nodejs'`): auth → `generateTrainingPlan` →
      `{ planId, sessionCount }`.

### Task 2.2 — Read endpoint / loader
- [ ] `GET /api/plan` (or server-component query): active plan + its sessions ordered by date.

---

## Phase 3 — Plan UI

### Task 3.1 — Replace the /plan stub
- [ ] Build `PlanView` client component: week-grouped session list (or calendar), session cards with
      type/target/status, completed sessions linking to the activity.
- [ ] "Generate plan" CTA when no active plan; calls `POST /api/plan/generate`, then refresh.
- [ ] Keyboard-navigable + ARIA labelled.

---

## Phase 4 — Lifecycle & adaptation

### Task 4.1 — Single active plan
- [ ] Enforce one active plan in the workflow (archive others). Consider a partial unique index later.

### Task 4.2 — Adaptation tool
- [ ] Add `adjustUpcomingSessions` to `buildCoachTools` — edits ONLY `scheduled_date >= today AND
      status='pending'` sessions. Keep `updateSessionStatus` working.

### Task 4.3 — Activity → session auto-link
- [ ] In `insertManualActivity` (and later upload), best-effort link a new activity to a same-day +
      same-sport `pending` session: set it `completed` + `completed_activity_id`. Non-fatal.

---

## Phase 5 — Chat integration (sequence-flexible)

### Task 5.1 — generatePlan tool
- [ ] Add `generatePlan` to `buildCoachTools`; confirm intent, call the SAME `generateTrainingPlan`,
      return a short summary (not every session). Prose two-turn confirm for now.
- [ ] Update coach prompt (`prompts/coach.ts`) with plan generation + adaptation guidance.
- [ ] OPTIONAL / gated on the chat data-stream spec: render a plan summary/confirm CARD instead of
      prose once that transport lands (register a plan card in the tool-card renderer). Not required
      for this feature to ship.

---

## Phase 6 — Verification

### Task 6.1 — Tests
- [ ] Unit: skeleton math + guardrail validators (out-of-window dates, unsafe ramp, rest days).
- [ ] Unit: `planToRows` mapping.
- [ ] Integration: mocked `generateObject` → archive+insert plan+sessions; cleanup on session-insert
      failure; activity auto-link.

### Task 6.2 — Build, lint, manual
- [ ] `npm run build` / `npm run lint` in `app/` (in-container).
- [ ] Manual: generate marathon plan → view → complete a session via logged activity → adapt after a
      missed week.
