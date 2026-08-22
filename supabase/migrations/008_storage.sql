-- ============================================================
-- Supabase Storage buckets and policies
-- ============================================================

-- Activities bucket — .FIT, .GPX, .TCX uploads
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'activities',
  'activities',
  false,
  52428800, -- 50 MB
  ARRAY['application/octet-stream', 'application/fit', 'application/gpx+xml', 'text/xml', 'application/xml']
)
ON CONFLICT (id) DO NOTHING;

-- Nutrition photos bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'nutrition',
  'nutrition',
  false,
  10485760, -- 10 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
ON CONFLICT (id) DO NOTHING;

-- Audio bucket — voice recordings
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'audio',
  'audio',
  false,
  26214400, -- 25 MB
  ARRAY['audio/webm', 'audio/wav', 'audio/mp4', 'audio/ogg', 'audio/mpeg']
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- Storage RLS policies — users can only access own files
-- Path convention: {user_id}/{filename}
-- ============================================================

-- Activities storage
CREATE POLICY "activities storage: users can view own"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'activities'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "activities storage: users can upload own"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'activities'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "activities storage: users can delete own"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'activities'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Nutrition storage
CREATE POLICY "nutrition storage: users can view own"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'nutrition'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "nutrition storage: users can upload own"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'nutrition'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "nutrition storage: users can delete own"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'nutrition'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Audio storage
CREATE POLICY "audio storage: users can view own"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'audio'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "audio storage: users can upload own"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'audio'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "audio storage: users can delete own"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'audio'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
