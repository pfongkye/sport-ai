-- ============================================================
-- Athlete constraints stored with each plan.
--
-- training_plans.constraints holds what the athlete asked for when generating:
--   { "unavailableWeekdays": ["tuesday", ...], "notes": "1 leisure session per week" }
-- so "Regenerate plan" can pre-fill the form. NULL = none / plan created before this column.
-- RLS on training_plans is already owner-scoped, so no policy changes.
--
-- Deleting a planned session needs NO migration: planned_sessions already has an owner-scoped
-- DELETE policy (004), suggested_routes.planned_session_id is ON DELETE SET NULL (014), and
-- planned_sessions.completed_activity_id points FROM the session TO the activity, so the
-- activity row is untouched. NOTE: routes unlinked this way become eligible for the
-- prune_suggested_routes() retention sweep (015) once they are older than the retention window.
--
-- Applied MANUALLY (gotcha #4), NOT auto-run. Idempotent. Apply it on the local stack AND on the
-- prod VM BEFORE deploying code that reads/writes the column (the plan page selects it).
--
--   docker exec -i sportai-db psql -U postgres -d postgres < supabase/migrations/017_training_plan_constraints.sql
-- ============================================================

ALTER TABLE public.training_plans
  ADD COLUMN IF NOT EXISTS constraints jsonb;

COMMENT ON COLUMN public.training_plans.constraints IS
  'Athlete constraints used to generate the plan: {unavailableWeekdays: string[], notes: string|null}. NULL when none.';

NOTIFY pgrst, 'reload schema';
