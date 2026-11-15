-- ============================================================
-- Training recap snapshot stored with each plan.
--
-- training_plans.recap holds the deterministic recap (see
-- app/src/lib/ai/workflows/training-recap.ts) that the plan was built from.
-- It carries a schemaVersion field. NULL for plans created before this column.
-- RLS on training_plans is already owner-scoped, so no policy changes.
--
-- Applied MANUALLY (gotcha #4) — NOT auto-run. Idempotent. Apply it on the local
-- stack AND on the prod VM BEFORE deploying code that writes the column.
--
--   docker exec -i sportai-db psql -U postgres -d postgres < supabase/migrations/016_training_plan_recap.sql
-- ============================================================

ALTER TABLE public.training_plans
  ADD COLUMN IF NOT EXISTS recap jsonb;

COMMENT ON COLUMN public.training_plans.recap IS
  'Deterministic training recap snapshot the plan was generated from (has schemaVersion). NULL for older plans.';

NOTIFY pgrst, 'reload schema';
