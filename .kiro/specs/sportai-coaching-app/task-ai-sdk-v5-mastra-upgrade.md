# Task: Upgrade AI SDK v4 → v5 and Mastra 0.24 → 1.x

> **Standalone task doc.** Written so a fresh session with no prior context can execute it.
> Read `AGENTS.md` gotchas #33 and #35 first — they explain the exact failure modes this
> upgrade is meant to escape. Also read `app/src/lib/ai/*` before changing anything.

## Why this task exists

The app is deliberately pinned to the **AI SDK v4 line** to match `@mastra/core@0.24.9`:

```
@ai-sdk/openai   1.3.24   (LanguageModelV1 → specificationVersion "v1")
@ai-sdk/anthropic 1.2.12
@ai-sdk/google   1.2.22
ai               4.3.19
@mastra/core     0.24.9
```

These are pinned **exact** (no `^`) in `app/package.json` because a stray float to v5 kept
breaking the coach chat: AI SDK v5 produces `v2`/`v3` (`openai.responses`) models that
`@mastra/core@0.24` rejects, yielding empty chat responses ("No response. Try again."). See
AGENTS.md #35.

Staying on v4 is fine for now, but it's an aging line. This task moves the whole stack to the
current generation so we get ongoing support, new provider/model features, and a single
streaming API. **It is a real migration with behavior-affecting changes — do it deliberately,
on its own branch, with full testing. Do NOT bundle it into an unrelated change.**

As of the last check, latest was roughly `@ai-sdk/openai@4.0.91`, `ai@7.x`,
`@mastra/core@1.76.0` — re-check actual latest at execution time; pin exact once chosen.

## Goal / definition of done

- Stack upgraded to current AI SDK v5 + current `@mastra/core` 1.x, pinned **exact**.
- Coach chat streams text for BOTH tool-calling questions (e.g. "what's my fastest 1km
  segment?" → `getBestSplits`) and non-tool questions. No empty responses.
- Activity post-session insight streaming still works.
- Natural-language activity parse (`generateObject`) still works.
- All typed coach tools still callable (listed below).
- `npm run build` (TypeScript) and `npx eslint` clean.
- Works in BOTH run modes: host `npm run dev` AND the Docker `app` container (gotcha #16 — the
  container has its own `node_modules` volume; `npm ci` inside it after dep changes).
- Prod image rebuilds cleanly via Cloud Build from the lockfile.

## Current surface to migrate (every AI-SDK/Mastra touch point)

Verified by grep at authoring time — re-grep to confirm nothing new was added:
`grep -rnE "@ai-sdk|@mastra|streamLegacy|\.stream\(|generateObject|createOpenAI|createAnthropic|createGoogleGenerativeAI" app/src`

1. **`app/src/lib/ai/provider.ts`**
   - `resolveModel(provider, modelId, userApiKey)` — builds the model via
     `createOpenAI` / `createAnthropic` / `createGoogleGenerativeAI`. In v5 these factories and
     the returned model type change (LanguageModelV2). Update the three provider factories.
   - `warnOnModelVersionDrift(model)` — the preflight expects `specificationVersion === 'v1'`.
     After the upgrade the expected value becomes the v5 value (`'v2'`). **Update this check** to
     the new expected version (or remove it if the whole class of bug is gone post-migration).
   - `AVAILABLE_MODELS` / `DEFAULT_MODELS` maps — verify model ids are still valid for v5
     providers; add newer models if desired (separate decision).
   - `resolveUserAISettings` (decrypts the user's BYO key) is unaffected by the SDK version.

2. **`app/src/lib/ai/agents/coach.ts`**
   - `buildCoachAgent(...)` — `new Agent({ name, instructions, model, tools })` from
     `@mastra/core/agent`. Check the Mastra 1.x `Agent` constructor + how the model is passed
     (the `model as any` cast may change).
   - `streamAgentText(agent, messages)` — the whole try-`stream()`-then-fallback-`streamLegacy()`
     shim exists ONLY to tolerate the v1/v2 ambiguity. **In v5-only, delete the shim and call
     `agent.stream(messages)` directly** (Mastra 1.x `stream()` is the single API). Preserve the
     `{ textStream }` return shape the routes consume, or update both call sites.

3. **`app/src/app/api/ai/chat/route.ts`**
   - Calls `streamAgentText(agent, llmMessages)` and iterates `result.textStream`, teeing to the
     client and accumulating `full` for persistence to `coaching_messages`. Confirm `.textStream`
     still exists on the Mastra 1.x stream result (reference docs showed it does). Adjust if the
     result shape changed (may now be `MastraModelOutput` with `.textStream` + `.text`).
   - Message typing: currently builds `CoreMessage[]` from `ai`. v5 renamed/retyped message types
     (e.g. `ModelMessage`). Update imports/types.
   - IMPORTANT: this route must keep returning a `text/plain` stream to the existing client
     (`app/src/components/chat/*` reads a plain text stream, not an AI-SDK data stream). Don't
     switch the client to `useChat`/data-stream protocol as part of this task unless you also
     update the client — keep scope to the plain text stream.

4. **`app/src/app/api/activities/[id]/insight/route.ts`**
   - Same `streamAgentText(...)` + `result.textStream` pattern. Update identically.

5. **`app/src/lib/ai/parse-activity.ts`**
   - Uses `generateObject` from `ai` with a zod schema (`parsedDraftSchema`). v5's
     `generateObject` signature changed (e.g. `maxTokens` → `maxOutputTokens`, result fields).
     Update the call and result handling. Verify the voice/text "add activity" flow still parses.

6. **`app/src/lib/ai/tools/index.ts`**
   - `createTool({ id, description, inputSchema, execute })` from `@mastra/core/tools`. Check the
     Mastra 1.x tool API (execute signature/`context` shape may change). Tools to keep working:
     `getRecentActivities`, `getTrainingLoad`, `getBestSplits`, `getPlannedSessions`,
     `getUserProfile`, `updateSessionStatus`, `addActivity`, `listStravaActivities`,
     `importFromStrava`.

7. **`app/src/lib/ai/prompts/coach.ts`** — plain string builder, no SDK dependency. Likely
   untouched, but re-verify after the agent changes.

## Step-by-step plan

1. **Branch**: `git checkout -b upgrade/ai-sdk-v5-mastra-1x`.
2. **Read the official migration guides** (don't guess APIs):
   - Mastra VNext→standard streaming migration: https://mastra.ai/reference/migrations/vnext-to-standard-apis
   - Mastra `agent.stream()` reference: https://mastra.ai/reference/streaming/agents/stream
   - AI SDK v4→v5 migration guide (Vercel docs).
   Confirm exact latest versions: `npm view @ai-sdk/openai version`, `npm view ai version`,
   `npm view @mastra/core version`. Also bump `@ai-sdk/anthropic` / `@ai-sdk/google` to their
   matching v5-era majors.
3. **Update `app/package.json`** — pin EXACT (no `^`) for all five:
   `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`, `ai`, `@mastra/core` (keep them a
   consistent generation). Run `npm install` to regenerate `package-lock.json`.
4. **Migrate code** in this order (compile after each): `provider.ts` → `tools/index.ts` →
   `coach.ts` (delete the `streamAgentText` shim; use `stream()` directly) → the two routes →
   `parse-activity.ts`. Update message types from `ai`.
5. **Update the drift preflight** (`warnOnModelVersionDrift`) to expect the new spec version, or
   remove it if obsolete. Update the top-of-file comments in `coach.ts`/`provider.ts` that
   describe the v1/streamLegacy design.
6. **Build + lint**: `cd app && npm run build && npx eslint src` — must be clean.
7. **Sync the Docker container** (gotcha #16): bring up the stack, then
   `docker exec sportai-app sh -lc 'cd /app && npm ci'` and
   `docker compose --env-file .env restart app` (or `up -d --force-recreate --renew-anon-volumes app`
   to be certain the stale node_modules volume is gone).

## Verification (must pass before "done")

**First, the characterization tests** — these pin today's deterministic behaviour and must stay
green through the migration (update them only if the migration intentionally changes a result,
and say so):

```
cd app && npm test
```

Covers (all offline, no OpenAI/DB): `computeBestSplits` (the fastest-segment math),
`stravaToNormalized` (Strava mapping + external_id), `insertNormalizedActivity` (dedup
contract), `stravaErrorResponse` (sentinel mapping), `isEmailAllowed` (login allow-list), and
`buildCoachTools` (all 9 tools wired with correct ids — a canary for the Mastra tool API).
If the Mastra/AI-SDK upgrade changes the tool API or the stream result shape, the
`buildCoachTools` test breaks first and tells you exactly what moved.

**Then** run the live stack (`docker/`: `docker compose --env-file .env up -d`; set the encryption key
per README step 4). Then, as the real user, exercise:

- **Coach chat, tool path**: "what is my fastest 1km segment on my most recent run?" → expect a
  real numeric answer (uses `getBestSplits`). THIS is the regression that motivated the task.
- **Coach chat, non-tool path**: a general training question → streams prose.
- **Coach chat, Strava tool**: "list my recent Strava activities" / "import my last 2 Strava
  runs" → `listStravaActivities` / `importFromStrava` respond.
- **Insight**: open an activity detail page → the post-session insight streams.
- **Parse**: add an activity by voice/text ("ran 10k at 5:14/km, hr 139") → draft parses.
- Confirm the chat reply is persisted to `coaching_messages` (the route still accumulates `full`).
- Repeat the fastest-segment check INSIDE the Docker container run mode, not just host.

A fast, auth-free repro harness (used last time): a temporary route
`app/src/app/api/<name>/route.ts` that builds the agent for a hardcoded user id and streams the
"fastest 1km" question, returning `{ chunks, textLength, textPreview }`. **Delete it when done.**
Note: Next.js App Router excludes folders beginning with `_`, so don't name it `_debug`.

## Deploy (after local verification)

- Redeploy the app: `./deploy/gcp/04_deploy_app_cloudrun.sh` (Cloud Build builds the prod image
  from the lockfile via `npm ci`, so exact pins carry to prod).
- Re-run the fastest-segment check against the Cloud Run URL.

## Risks / gotchas specific to this upgrade

- **Mastra 0.24 → 1.x is a MAJOR jump** — Agent constructor, tool API, and streaming result
  shape may all differ from what's in the code today. Follow the official guide; don't infer.
- The existing chat **client** consumes a plain `text/plain` stream. If you adopt the AI SDK v5
  UI data-stream protocol, you MUST update the client too — otherwise keep emitting plain text.
- The repo installs BOTH `ai` and the aliased `ai-v5`/`@ai-sdk/*-v5` packages TODAY — the `-v5`
  ones are transitive deps of `@mastra/core@0.24` (AGENTS.md #33), NOT ours. After upgrading
  `@mastra/core`, re-check what's in the tree; the alias set will change. Don't hand-remove them.
- Keep deps pinned EXACT at the end and re-read AGENTS.md #35 — the whole point is that a future
  stray install can't float the versions again.
- Update AGENTS.md gotchas #33/#35 once migrated (note the stack is now v5 and the streamLegacy
  shim is gone), so the living memory reflects reality.

## Out of scope (do NOT do here)

- Switching the chat client to `useChat` / AI-SDK data-stream protocol (separate task).
- Adding new providers/models or changing default models (separate decision).
- Re-introducing MCP (explicitly rejected — AGENTS.md #20).
