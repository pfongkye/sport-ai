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

### Task 2.3 — Reschedule endpoint (Req 2a.4)
- [ ] `PATCH /api/plan/sessions/[id]/reschedule` (`runtime='nodejs'`): auth → load session (RLS,
      owner) → re-validate FUTURE (`scheduled_date >= today` in athlete tz) AND `status='pending'`
      server-side → update only `scheduled_date` (set `status='modified'` + `ai_notes` manual-move
      trace, Req 2a.3). Reject past/completed/non-owned with a clear error. Use the SHARED
      future-and-pending predicate helper (see Task 4.2) — don't duplicate the filter.

---

## Phase 3 — Plan UI

### Task 3.1 — Replace the /plan stub (week-grouped calendar, mobile-first)
- [ ] Build `PlanView` client component: **week-grouped calendar view** (Req 2.1) — sessions in day
      slots grouped by week; session cards with type/target/status; completed sessions link to the
      activity.
- [ ] "Generate plan" CTA when no active plan; calls `POST /api/plan/generate`, then refresh.
- [ ] **Mobile-first** (Req 2.1/5.3): single-week/single-column on a phone, scaling to a multi-column
      week grid on larger screens; no horizontal scroll or clipped day cells. Verify on a narrow
      viewport before done.
- [ ] Keyboard-navigable + ARIA labelled.

### Task 3.2 — Manual reschedule control (Req 2a)
- [ ] On each FUTURE `pending` session card, add a keyboard-accessible "reschedule to date" control
      (date picker / "move to…" affordance — NOT drag-and-drop in v1). Touch-friendly, no hover-only
      affordance (gotcha #23). Past/completed sessions show no control.
- [ ] On change, call `PATCH /api/plan/sessions/[id]/reschedule` and refresh the view. Surface a
      screen-reader confirmation of the new date (Req 2a.5). Run `npx eslint` on the client
      component (gotcha #28 — set-state-in-effect not caught by build).

---

## Phase 4 — Lifecycle & adaptation

### Task 4.1 — Single active plan
- [ ] Enforce one active plan in the workflow (archive others). Consider a partial unique index later.

### Task 4.2 — Adaptation tool + shared guardrail helper
- [ ] Factor the future-and-pending predicate into ONE shared helper (`scheduled_date >= today` in
      athlete tz AND `status='pending'`) used by BOTH the reschedule endpoint (Task 2.3) and
      `adjustUpcomingSessions` — so the AI and manual paths can't diverge (design careful-point #5).
- [ ] Add `adjustUpcomingSessions` to `buildCoachTools` — edits ONLY future `pending` sessions via
      that helper. Keep `updateSessionStatus` working.

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
- [ ] Unit: the shared future-and-pending predicate helper (Task 4.2) — accepts future pending,
      rejects past and non-pending; timezone boundary at "today".
- [ ] Integration: mocked `generateObject` → archive+insert plan+sessions; cleanup on session-insert
      failure; activity auto-link.
- [ ] Integration: reschedule endpoint moves a future pending session's date (status→modified) and
      REJECTS a past/completed session and a non-owner (Req 2a.2/2a.4).

### Task 6.2 — Build, lint, manual
- [ ] `npm run build` / `npm run lint` in `app/` (in-container); `npx eslint` on new client
      components (gotcha #28).
- [ ] Manual: generate marathon plan → view the **week calendar on a phone viewport** → complete a
      session via logged activity → **reschedule a future session to another day** (confirm a
      past/completed one offers no control) → adapt after a missed week.
