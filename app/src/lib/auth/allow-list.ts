/**
 * App-level login allow-list (exact emails).
 *
 * Google OAuth itself has no per-user allow-list, so access control lives here:
 * only emails present in ALLOWED_EMAILS may use the app. Enforced in the OAuth
 * callback (reject + delete the just-created user) AND re-checked in middleware
 * (so removing someone from the list locks out their existing session too).
 *
 * ALLOWED_EMAILS is a comma/whitespace-separated, server-only env var, e.g.
 *   ALLOWED_EMAILS="a@example.com, b@example.com"
 * Matching is exact and case-insensitive.
 *
 * NOTE: this is the near-term solution. The long-term plan is a DB-backed
 * allowed_emails table editable without a redeploy (see AGENTS.md / README).
 *
 * Fail-closed vs fail-open: if ALLOWED_EMAILS is UNSET or empty, the allow-list
 * is DISABLED (everyone with a valid Google login is allowed). This keeps local
 * dev frictionless. Set the var to turn gating on. If you want it always-on,
 * flip `allowListEnabled` to throw when unset.
 */

/** Parse the env var into a normalized Set of allowed emails. */
function parseAllowedEmails(): Set<string> {
  const raw = process.env.ALLOWED_EMAILS ?? ''
  return new Set(
    raw
      .split(/[,\s]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  )
}

/** True when an allow-list is configured (non-empty). When false, all allowed. */
export function allowListEnabled(): boolean {
  return parseAllowedEmails().size > 0
}

/**
 * Is this email permitted to use the app?
 * - No allow-list configured → everyone allowed (returns true).
 * - Allow-list configured → exact, case-insensitive membership.
 * - Missing/empty email with an active allow-list → denied.
 */
export function isEmailAllowed(email: string | null | undefined): boolean {
  const allowed = parseAllowedEmails()
  if (allowed.size === 0) return true // allow-list disabled
  if (!email) return false
  return allowed.has(email.trim().toLowerCase())
}
