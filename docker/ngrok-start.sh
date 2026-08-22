#!/usr/bin/env bash
#
# ngrok-start.sh — renders docker/ngrok.yml from env vars and starts both tunnels.
#
# Reads (from docker/.env, or your current shell — shell wins):
#   NGROK_AUTHTOKEN        — from https://dashboard.ngrok.com
#   NGROK_SUPABASE_DOMAIN  — your free static domain (claim at dashboard.ngrok.com/domains)
#
# Usage:
#   ./docker/ngrok-start.sh
#
# After it starts, in another terminal run ./docker/ngrok-sync.sh to update env files.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE="$SCRIPT_DIR/ngrok.yml"
RENDERED="$SCRIPT_DIR/.ngrok.rendered.yml"
DOCKER_ENV="$SCRIPT_DIR/.env"

# Load values from docker/.env if present (shell env takes precedence).
if [[ -f "$DOCKER_ENV" ]]; then
  # Only export the two keys we care about, without clobbering existing shell vars.
  while IFS='=' read -r key val; do
    [[ "$key" == "NGROK_AUTHTOKEN" && -z "${NGROK_AUTHTOKEN:-}" ]] && export NGROK_AUTHTOKEN="$val"
    [[ "$key" == "NGROK_SUPABASE_DOMAIN" && -z "${NGROK_SUPABASE_DOMAIN:-}" ]] && export NGROK_SUPABASE_DOMAIN="$val"
  done < <(grep -E '^(NGROK_AUTHTOKEN|NGROK_SUPABASE_DOMAIN)=' "$DOCKER_ENV" || true)
fi

# Validate
missing=0
if [[ -z "${NGROK_AUTHTOKEN:-}" ]]; then
  echo "ERROR: NGROK_AUTHTOKEN is not set (shell or docker/.env)." >&2
  echo "  Get it from https://dashboard.ngrok.com and add to docker/.env:" >&2
  echo "    NGROK_AUTHTOKEN=your-token" >&2
  missing=1
fi
if [[ -z "${NGROK_SUPABASE_DOMAIN:-}" ]]; then
  echo "ERROR: NGROK_SUPABASE_DOMAIN is not set (shell or docker/.env)." >&2
  echo "  Claim a free domain at https://dashboard.ngrok.com/domains and add to docker/.env:" >&2
  echo "    NGROK_SUPABASE_DOMAIN=your-name-1234.ngrok-free.app" >&2
  missing=1
fi
[[ "$missing" == "1" ]] && exit 1

# Render the template. Prefer envsubst; fall back to sed if unavailable.
if command -v envsubst >/dev/null 2>&1; then
  envsubst '${NGROK_AUTHTOKEN} ${NGROK_SUPABASE_DOMAIN}' < "$TEMPLATE" > "$RENDERED"
else
  sed -e "s|\${NGROK_AUTHTOKEN}|${NGROK_AUTHTOKEN}|g" \
      -e "s|\${NGROK_SUPABASE_DOMAIN}|${NGROK_SUPABASE_DOMAIN}|g" \
      "$TEMPLATE" > "$RENDERED"
fi

echo "Starting ngrok:"
echo "  app       → random URL (:3000)"
echo "  supabase  → https://${NGROK_SUPABASE_DOMAIN} (:8000)"
echo
echo "In another terminal, run:  ./docker/ngrok-sync.sh"
echo

# --all starts every tunnel defined in the rendered config.
exec ngrok start --all --config "$RENDERED"
