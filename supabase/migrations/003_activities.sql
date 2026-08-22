-- ============================================================
-- Activities — normalized workout records from any source
-- ============================================================

CREATE TABLE public.activities (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source            text        NOT NULL CHECK (source IN (
                                  'upload_fit', 'upload_gpx', 'upload_tcx',
                                  'strava', 'garmin', 'coros', 'manual'
                                )),
  external_id       text,
  sport_type        text        NOT NULL CHECK (sport_type IN ('run', 'football', 'gym', 'cycle', 'other')),
  started_at        timestamptz NOT NULL,
  duration_s        integer     CHECK (duration_s > 0),
  distance_m        numeric(10, 2) CHECK (distance_m >= 0),
  elevation_gain_m  numeric(8, 2),
  avg_hr_bpm        integer     CHECK (avg_hr_bpm BETWEEN 30 AND 250),
  max_hr_bpm        integer     CHECK (max_hr_bpm BETWEEN 30 AND 250),
  avg_pace_s_per_km integer     CHECK (avg_pace_s_per_km > 0),
  avg_cadence_rpm   integer     CHECK (avg_cadence_rpm BETWEEN 0 AND 300),
  calories_kcal     integer     CHECK (calories_kcal >= 0),
  training_load     numeric(6, 2) CHECK (training_load >= 0),
  rpe               integer     CHECK (rpe BETWEEN 1 AND 10),
  notes             text,
  file_url          text,
  raw_data          jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),

  -- Deduplication: same user can't have two records from same external source
  UNIQUE (user_id, external_id)
);

-- Indexes
CREATE INDEX activities_user_started
  ON public.activities (user_id, started_at DESC);

CREATE INDEX activities_user_sport
  ON public.activities (user_id, sport_type);

CREATE INDEX activities_user_source
  ON public.activities (user_id, source);

-- Row Level Security
ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "activities: users can view own"
  ON public.activities FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "activities: users can insert own"
  ON public.activities FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "activities: users can update own"
  ON public.activities FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "activities: users can delete own"
  ON public.activities FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================
-- Activity Streams — time-series data points per activity
-- ============================================================

CREATE TABLE public.activity_streams (
  id            uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id   uuid    NOT NULL REFERENCES public.activities(id) ON DELETE CASCADE,
  user_id       uuid    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stream_type   text    NOT NULL CHECK (stream_type IN (
                          'heartrate', 'pace', 'cadence', 'altitude', 'latlng', 'power'
                        )),
  data          jsonb   NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),

  UNIQUE (activity_id, stream_type)
);

CREATE INDEX activity_streams_activity
  ON public.activity_streams (activity_id);

-- RLS
ALTER TABLE public.activity_streams ENABLE ROW LEVEL SECURITY;

CREATE POLICY "streams: users can view own"
  ON public.activity_streams FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "streams: users can insert own"
  ON public.activity_streams FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "streams: users can delete own"
  ON public.activity_streams FOR DELETE
  USING (auth.uid() = user_id);
