-- ============================================================
-- Fix: encrypt_api_key / decrypt_api_key could not find pgcrypto
--
-- Symptom: anything that encrypts a stored secret (AI provider keys, Strava
-- OAuth tokens) failed with:
--   ERROR: function pgp_sym_encrypt(text, text) does not exist
-- even though pgcrypto IS installed.
--
-- Cause: Supabase installs pgcrypto into the `extensions` schema (not public).
-- The functions in migration 007 were defined with `SET search_path = public`,
-- which EXCLUDES `extensions`, so `pgp_sym_encrypt` / `pgp_sym_decrypt` were not
-- resolvable from inside the function body. (The DB's default search_path does
-- include `extensions`, which is why direct calls outside the function worked.)
--
-- Fix: pin `search_path = public, extensions` on both SECURITY DEFINER functions
-- so pgcrypto resolves, while still keeping an explicit, minimal path. Bodies are
-- otherwise identical to 007. CREATE OR REPLACE so this is safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION public.encrypt_api_key(key_text text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, extensions
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
SECURITY DEFINER SET search_path = public, extensions
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

-- Re-assert grants (CREATE OR REPLACE keeps them, but be explicit/idempotent).
REVOKE ALL ON FUNCTION public.encrypt_api_key(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.decrypt_api_key(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.encrypt_api_key(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.decrypt_api_key(text) TO service_role;
