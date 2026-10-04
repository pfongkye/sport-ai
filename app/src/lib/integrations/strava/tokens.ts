/**
 * Strava connection + token management.
 *
 * Tokens are stored ENCRYPTED in public.strava_connections via the pgcrypto
 * encrypt_api_key / decrypt_api_key RPCs (service_role only). This module is the
 * single place that reads/writes those tokens and transparently refreshes an
 * expired access token. Always use `getValidAccessToken` before calling the
 * Strava API — never read access_token_enc directly elsewhere.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import {
  refreshAccessToken,
  type StravaTokenResponse,
} from './client'

/** Refresh a bit early so a call doesn't race the expiry boundary. */
const EXPIRY_SKEW_S = 120

export interface StravaConnectionRow {
  user_id: string
  athlete_id: string
  expires_at: number
  scope: string | null
  athlete_firstname: string | null
  athlete_lastname: string | null
  athlete_username: string | null
  last_synced_at: string | null
}

async function encrypt(admin: SupabaseClient<Database>, plaintext: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await admin.rpc('encrypt_api_key' as any, { key_text: plaintext })
  if (error || !data) throw new Error(`Failed to encrypt Strava token: ${error?.message}`)
  return data as string
}

async function decrypt(admin: SupabaseClient<Database>, enc: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await admin.rpc('decrypt_api_key' as any, { key_enc: enc })
  if (error || !data) throw new Error(`Failed to decrypt Strava token: ${error?.message}`)
  return data as string
}

/**
 * Persist (insert or update) a connection from a fresh token response.
 * Called from the OAuth callback (first connect) and after a refresh.
 */
export async function saveConnection(
  admin: SupabaseClient<Database>,
  userId: string,
  token: StravaTokenResponse
): Promise<void> {
  const [accessEnc, refreshEnc] = await Promise.all([
    encrypt(admin, token.access_token),
    encrypt(admin, token.refresh_token),
  ])

  // Upsert on the PK (user_id). On REFRESH, Strava returns neither the athlete
  // block nor scope, and the row already exists — so we must not clobber those
  // columns with nulls. We therefore only set the fields we actually have.
  const row: Record<string, unknown> = {
    user_id: userId,
    access_token_enc: accessEnc,
    refresh_token_enc: refreshEnc,
    expires_at: token.expires_at,
    updated_at: new Date().toISOString(),
  }
  const scope = (token as unknown as { scope?: string }).scope
  if (scope) row.scope = scope
  if (token.athlete) {
    row.athlete_id = String(token.athlete.id)
    row.athlete_firstname = token.athlete.firstname ?? null
    row.athlete_lastname = token.athlete.lastname ?? null
    row.athlete_username = token.athlete.username ?? null
  }

  const { error } = await admin.from('strava_connections').upsert(row, { onConflict: 'user_id' })
  if (error) throw new Error(`Failed to save Strava connection: ${error.message}`)
}

/** Does this user have a Strava connection? Returns the public row or null. */
export async function getConnection(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<StravaConnectionRow | null> {
  const { data } = await supabase
    .from('strava_connections')
    .select(
      'user_id, athlete_id, expires_at, scope, athlete_firstname, athlete_lastname, athlete_username, last_synced_at'
    )
    .eq('user_id', userId)
    .maybeSingle()
  return (data as StravaConnectionRow) ?? null
}

/**
 * Return a currently-valid access token for the user, refreshing it (and
 * persisting the new tokens) if it's expired or about to expire. Throws
 * STRAVA_NOT_CONNECTED if there's no connection.
 */
export async function getValidAccessToken(
  admin: SupabaseClient<Database>,
  userId: string
): Promise<string> {
  const { data, error } = await admin
    .from('strava_connections')
    .select('access_token_enc, refresh_token_enc, expires_at')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw new Error(`Failed to read Strava connection: ${error.message}`)
  if (!data) throw new Error('STRAVA_NOT_CONNECTED')

  const row = data as {
    access_token_enc: string
    refresh_token_enc: string
    expires_at: number
  }

  const now = Math.floor(Date.now() / 1000)
  if (row.expires_at - EXPIRY_SKEW_S > now) {
    return decrypt(admin, row.access_token_enc)
  }

  // Expired → refresh with the (decrypted) refresh token, then persist.
  const refreshToken = await decrypt(admin, row.refresh_token_enc)
  const refreshed = await refreshAccessToken(refreshToken)
  await saveConnection(admin, userId, refreshed)
  return refreshed.access_token
}

/** Remove a user's Strava connection (disconnect). */
export async function deleteConnection(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<void> {
  const { error } = await supabase.from('strava_connections').delete().eq('user_id', userId)
  if (error) throw new Error(`Failed to disconnect Strava: ${error.message}`)
}

/** Stamp last_synced_at = now for the connection. */
export async function markSynced(
  admin: SupabaseClient<Database>,
  userId: string
): Promise<void> {
  await admin
    .from('strava_connections')
    .update({ last_synced_at: new Date().toISOString() })
    .eq('user_id', userId)
}
