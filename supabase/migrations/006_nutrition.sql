-- ============================================================
-- Nutrition Logs — meal photo analysis and macro tracking
-- ============================================================

CREATE TABLE public.nutrition_logs (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  logged_at       timestamptz NOT NULL DEFAULT now(),
  meal_type       text        CHECK (meal_type IN (
                                'breakfast', 'lunch', 'dinner', 'snack',
                                'pre-workout', 'post-workout'
                              )),
  photo_url       text,
  -- AI Vision identified foods: [{name, grams, confidence}]
  ai_identified   jsonb,
  -- User corrections: [{name, grams}]
  user_corrected  jsonb,
  -- Final macros: {calories_kcal, protein_g, carbs_g, fat_g, fiber_g}
  macros          jsonb,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX nutrition_logs_user_date
  ON public.nutrition_logs (user_id, logged_at DESC);

ALTER TABLE public.nutrition_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "nutrition: users can view own"
  ON public.nutrition_logs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "nutrition: users can insert own"
  ON public.nutrition_logs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "nutrition: users can update own"
  ON public.nutrition_logs FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "nutrition: users can delete own"
  ON public.nutrition_logs FOR DELETE
  USING (auth.uid() = user_id);
