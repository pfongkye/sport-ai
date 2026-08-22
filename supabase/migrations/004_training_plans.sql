-- ============================================================
-- Training Plans and Planned Sessions
-- ============================================================

CREATE TABLE public.training_plans (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title       text        NOT NULL,
  goal        text,
  start_date  date        NOT NULL,
  end_date    date        NOT NULL,
  status      text        NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'completed', 'archived')),
  created_at  timestamptz NOT NULL DEFAULT now(),

  CHECK (end_date > start_date)
);

CREATE INDEX training_plans_user
  ON public.training_plans (user_id, status);

ALTER TABLE public.training_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "plans: users can view own"
  ON public.training_plans FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "plans: users can insert own"
  ON public.training_plans FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "plans: users can update own"
  ON public.training_plans FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "plans: users can delete own"
  ON public.training_plans FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================
-- Planned Sessions — individual sessions within a plan
-- ============================================================

CREATE TABLE public.planned_sessions (
  id                      uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id                 uuid    NOT NULL REFERENCES public.training_plans(id) ON DELETE CASCADE,
  user_id                 uuid    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scheduled_date          date    NOT NULL,
  sport_type              text    NOT NULL CHECK (sport_type IN ('run', 'football', 'gym', 'cycle', 'other')),
  session_type            text,   -- 'easy', 'tempo', 'long run', 'intervals', 'rest', etc.
  description             text,
  target_distance_m       integer CHECK (target_distance_m > 0),
  target_duration_s       integer CHECK (target_duration_s > 0),
  target_hr_zone          integer CHECK (target_hr_zone BETWEEN 1 AND 5),
  status                  text    NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending', 'completed', 'skipped', 'modified')),
  completed_activity_id   uuid    REFERENCES public.activities(id) ON DELETE SET NULL,
  ai_notes                text,
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX planned_sessions_user_date
  ON public.planned_sessions (user_id, scheduled_date);

CREATE INDEX planned_sessions_plan
  ON public.planned_sessions (plan_id, scheduled_date);

ALTER TABLE public.planned_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sessions: users can view own"
  ON public.planned_sessions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "sessions: users can insert own"
  ON public.planned_sessions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "sessions: users can update own"
  ON public.planned_sessions FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "sessions: users can delete own"
  ON public.planned_sessions FOR DELETE
  USING (auth.uid() = user_id);
