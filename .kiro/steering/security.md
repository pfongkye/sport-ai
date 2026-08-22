# Security rules (always applies)

## Never read secret / sensitive files

Do NOT open, read, cat, print, or otherwise load the contents of files that contain
secrets. This includes at minimum:

- `**/.env`, `**/.env.*` (e.g. `app/.env.local`, `docker/.env`) — EXCEPT `*.env.example`
  and `*.env.local.example`, which are safe templates and may be read.
- Any file matching `*secret*`, `*credential*`, `*.pem`, `*.key`, `*.p12`, `*.keystore`
- Cloud credential files (`**/.aws/credentials`, service-account JSON, etc.)
- The rendered ngrok config `docker/.ngrok.rendered.yml` (contains the authtoken)

When you need to work with these files:
- You MAY create or edit them (e.g. add a new key) using edit tools, but do so by
  targeting specific lines/keys — avoid reading the whole file back.
- Reference values by their KEY NAME, never echo the actual secret value into chat,
  logs, commits, or command output.
- Prefer the `*.example` template to understand what variables exist.

If a task seems to require reading a secret value, stop and ask the user to provide just
the specific piece needed, or use a placeholder.

## Handling secrets in code and commits

- Never hardcode secrets in source. Use environment variables.
- Never stage or commit `.env`, `docker/.env`, `app/.env.local`, or `*.env.bak` files
  (they are gitignored — keep it that way).
- When constructing shell commands that use secret env vars, read them via `$VAR`
  indirection rather than printing them.
