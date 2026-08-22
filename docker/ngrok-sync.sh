#!/usr/bin/env bash
#
# ngrok-sync.sh — reads the running ngrok tunnels and rewrites the app + docker
# env files to point at the public tunnel URLs, so mobile testing "just works".
#
# Prerequisite: ngrok must already be running with BOTH tunnels, e.g.
#   ngrok start --all --config docker/ngrok.yml
#
# Usage (from repo root or docker/):
#   ./docker/ngrok-sync.sh
#
# It:
#   1. Reads tunnel URLs from ngrok's local API (http://localhost:4040)
#   2. Maps the :3000 tunnel → APP url, the :8000 tunnel → SUPABASE url
#   3. Updates app/.env.local and docker/.env in place (backs them up first)
#   4. Prints the Google OAuth redirect URI you must whitelist
#
# To revert to localhost, run:  ./docker/ngrok-sync.sh --local

set -euo pipefail

# ── Resolve repo paths (script may be called from anywhere) ──────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_ENV="$REPO_ROOT/app/.env.local"
DOCKER_ENV="$REPO_ROOT/docker/.env"

# ── Helper: set or replace KEY=VALUE in a file (portable, macOS + Linux) ─────
set_env() {
  local file="$1" key="$2" value="$3"
  if grep -qE "^${key}=" "$file"; then
    # Replace existing line. Use a temp file to stay portable across sed variants.
    grep -vE "^${key}=" "$file" > "${file}.tmp"
    echo "${key}=${value}" >> "${file}.tmp"
    mv "${file}.tmp" "$file"
  else
    echo "${key}=${value}" >> "$file"
  fi
}

# ── --local mode: restore localhost values ───────────────────────────────────
if [[ "${1:-}" == "--local" ]]; then
  echo "Restoring localhost URLs..."
  set_env "$APP_ENV" "NEXT_PUBLIC_APP_URL" "http://localhost:3000"
  set_env "$APP_ENV" "NEXT_PUBLIC_SUPABASE_URL" "http://localhost:8000"
  set_env "$APP_ENV" "NEXT_ALLOWED_DEV_ORIGINS" ""
  set_env "$DOCKER_ENV" "SITE_URL" "http://localhost:3000"
  set_env "$DOCKER_ENV" "SUPABASE_PUBLIC_URL" "http://localhost:8000"
  set_env "$DOCKER_ENV" "API_EXTERNAL_URL" "http://localhost:8000/auth/v1"
  set_env "$DOCKER_ENV" "ADDITIONAL_REDIRECT_URLS" ""
  echo "✓ Reverted to localhost. Rebuild the app and 'docker compose --env-file .env up -d auth'."
  exit 0
fi

# ── Read ngrok tunnels from its local API ────────────────────────────────────
NGROK_API="http://localhost:4040/api/tunnels"

if ! curl -sf "$NGROK_API" >/dev/null 2>&1; then
  echo "ERROR: ngrok local API not reachable at $NGROK_API" >&2
  echo "Start ngrok first:  ngrok start --all --config docker/ngrok.yml" >&2
  exit 1
fi

TUNNELS_JSON="$(curl -sf "$NGROK_API")"

# Extract the public https URL for each local port using node (always available here).
APP_URL="$(node -e '
  const t = JSON.parse(require("fs").readFileSync(0, "utf8")).tunnels || [];
  const m = t.find(x => (x.config?.addr||"").endsWith(":3000") && x.proto === "https");
  process.stdout.write(m ? m.public_url : "");
' <<< "$TUNNELS_JSON")"

SUPABASE_URL="$(node -e '
  const t = JSON.parse(require("fs").readFileSync(0, "utf8")).tunnels || [];
  const m = t.find(x => (x.config?.addr||"").endsWith(":8000") && x.proto === "https");
  process.stdout.write(m ? m.public_url : "");
' <<< "$TUNNELS_JSON")"

if [[ -z "$APP_URL" || -z "$SUPABASE_URL" ]]; then
  echo "ERROR: could not find both tunnels (need :3000 and :8000)." >&2
  echo "Currently running tunnels:" >&2
  echo "$TUNNELS_JSON" | node -e '
    const t = JSON.parse(require("fs").readFileSync(0,"utf8")).tunnels||[];
    t.forEach(x => console.error("  " + (x.config?.addr||"?") + " → " + x.public_url));
  '
  echo "Start with:  ngrok start --all --config docker/ngrok.yml" >&2
  exit 1
fi

echo "Detected tunnels:"
echo "  app      → $APP_URL"
echo "  supabase → $SUPABASE_URL"
echo

# ── Back up env files ─────────────────────────────────────────────────────────
cp "$APP_ENV" "${APP_ENV}.bak"
cp "$DOCKER_ENV" "${DOCKER_ENV}.bak"

# Bare hosts (no scheme) for Next.js allowedDevOrigins
APP_HOST="${APP_URL#https://}"; APP_HOST="${APP_HOST#http://}"
SUPABASE_HOST="${SUPABASE_URL#https://}"; SUPABASE_HOST="${SUPABASE_HOST#http://}"

# ── Update app/.env.local (browser-facing) ────────────────────────────────────
set_env "$APP_ENV" "NEXT_PUBLIC_APP_URL" "$APP_URL"
set_env "$APP_ENV" "NEXT_PUBLIC_SUPABASE_URL" "$SUPABASE_URL"
# Allow the (rotating) ngrok app host to request Next.js /_next dev resources.
# Belt-and-suspenders alongside the wildcard patterns in next.config.ts.
set_env "$APP_ENV" "NEXT_ALLOWED_DEV_ORIGINS" "${APP_HOST},${SUPABASE_HOST}"

# ── Update docker/.env (auth server config) ───────────────────────────────────
set_env "$DOCKER_ENV" "SITE_URL" "$APP_URL"
set_env "$DOCKER_ENV" "SUPABASE_PUBLIC_URL" "$SUPABASE_URL"
set_env "$DOCKER_ENV" "API_EXTERNAL_URL" "${SUPABASE_URL}/auth/v1"
set_env "$DOCKER_ENV" "ADDITIONAL_REDIRECT_URLS" "${APP_URL}/**"

echo "✓ Updated app/.env.local and docker/.env (backups at *.bak)"
echo
echo "Next steps:"
echo "  1. Whitelist this Google OAuth redirect URI (Console → Clients):"
echo "       ${SUPABASE_URL}/auth/v1/callback"
echo "  2. Rebuild the app (NEXT_PUBLIC vars are baked in):"
echo "       cd app && npm run build && npm start"
echo "  3. Recreate auth to pick up new URLs:"
echo "       cd docker && docker compose --env-file .env up -d auth"
