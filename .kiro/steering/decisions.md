# Settled decisions (always applies — do NOT re-litigate)

These are choices the user has already made. Respect them. If you believe a different
approach is technically "better", that is NOT a reason to change it — STOP and ASK the user
first. Re-deriving these from first principles each session and silently flipping them wastes
the user's time and erodes trust.

## Voice transcription: `/audio/transcriptions` + `language` hint (NOT `/audio/translations`)
- Endpoint: OpenAI `/audio/transcriptions`, with `language: 'en'` for now.
- The `language` value is a spoken-language HINT (fixes mis-detection on short/accented
  clips). Text is kept in the language spoken — we do NOT translate.
- Do NOT switch to `/audio/translations` (force-English output). This has been decided
  multiple times.
- i18n is planned for later; at that point the hint comes from `user_settings.language`.
- File: `app/src/app/api/ai/voice/transcribe/route.ts`

## Language: English-only for now, i18n deferred
- Build UI/content in English. Full i18n is a later version — don't add i18n scaffolding now,
  but don't hardcode assumptions that make i18n hard either.

## AI tooling: typed Mastra tools only, no MCP in the app runtime
- The CoachAgent uses typed tools; MCP is intentionally not wired into the app (can't run on
  Vercel; security). See AGENTS.md gotcha #20. Revisit only via remote HTTP MCP if truly needed.

## Voice/audio retention: transcript-only
- Transcribe then DISCARD audio; store only the transcript. Do not persist recordings by
  default (cost + privacy). Audio storage is a future opt-in, everything for it already exists.

---
When adding a new settled decision here, keep it short: what was decided + the one-line why +
the file(s) it touches.
