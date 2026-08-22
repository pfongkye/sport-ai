-- ============================================================
-- User Settings — AI provider, units, preferences
-- ============================================================

CREATE TABLE public.user_settings (
  user_id         uuid    PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  ai_provider     text    NOT NULL DEFAULT 'openai'
                          CHECK (ai_provider IN ('openai', 'anthropic', 'google', 'mistral')),
  ai_model        text    NOT NULL DEFAULT 'gpt-4o',
  -- API key stored encrypted via pgcrypto — NEVER stored as plaintext
  ai_api_key_enc  text,
  units           text    NOT NULL DEFAULT 'metric'
                          CHECK (units IN ('metric', 'imperial')),
  language        text    NOT NULL DEFAULT 'en',
  timezone        text    NOT NULL DEFAULT 'UTC',
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "settings: users can view own"
  ON public.user_settings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "settings: users can insert own"
  ON public.user_settings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "settings: users can update own"
  ON public.user_settings FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "settings: users can delete own"
  ON public.user_settings FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER settings_updated_at
  BEFORE UPDATE ON public.user_settings
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- Auto-create settings row on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user_settings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_settings (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created_settings
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user_settings();

-- ============================================================
-- pgcrypto helpers — encrypt/decrypt AI API keys
-- Key is stored in environment / Vault, not in DB
-- ============================================================

CREATE OR REPLACE FUNCTION public.encrypt_api_key(key_text text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  encryption_key text;
BEGIN
  encryption_key := current_setting('app.encryption_key', true);
  IF encryption_key IS NULL OR encryption_key = '' THEN
    RAISE EXCEPTION 'app.encryption_key not set';
  END IF;
  RETURN encode(
    pgp_sym_encrypt(key_text, encryption_key),
    'base64'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.decrypt_api_key(key_enc text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  encryption_key text;
BEGIN
  encryption_key := current_setting('app.encryption_key', true);
  IF encryption_key IS NULL OR encryption_key = '' THEN
    RAISE EXCEPTION 'app.encryption_key not set';
  END IF;
  RETURN pgp_sym_decrypt(
    decode(key_enc, 'base64'),
    encryption_key
  );
END;
$$;

-- Revoke direct execute from public — only service_role can call
REVOKE ALL ON FUNCTION public.encrypt_api_key(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.decrypt_api_key(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.encrypt_api_key(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.decrypt_api_key(text) TO service_role;
