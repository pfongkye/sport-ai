# Interactive Tool UI in Coach Chat — Requirements

## Overview

Upgrade the AI Coach chat so the assistant can render **interactive cards** inline — starting
with an activity-draft confirm card for the `addActivity` tool. Today the chat streams plain text
only, so a tool result can't drive UI; the athlete confirms an activity by reading the assistant's
prose back and replying "yes". This feature gives the chat a structured transport (the Vercel AI
SDK data-stream protocol) so tool calls and their results reach the client and can be rendered as
real UI with Save / Edit / Discard controls.

This is the "Option 1" follow-on referenced in the `voice-freeform-activity-logging` spec. It is a
**chat transport upgrade**, not a new user-facing feature area — the first payoff is the activity
confirm card, but the same mechanism unlocks confirm cards for `updateSessionStatus` and any future
write tool.

---

## Rationale (why Option 1 over the alternatives)

- **Why not MCP.** MCP exposes tools/data to the model; it does not render UI in the chat. An MCP
  tool behaves like the existing Mastra tool — server-side execution, no client card. MCP also
  conflicts with the codebase's explicit decision (see `lib/ai/agents/coach.ts` header) to avoid
  stdio MCP because it can't run on the target host. So MCP does not address the actual gap.
- **Why not the text-sentinel hack (Option 2).** Emitting a tagged JSON block inside the text
  stream and parsing it client-side works with zero transport change, but it pattern-matches model
  output (fragile), gives no typed tool-call/tool-result states, and would have to be re-done
  properly later. Acceptable only as a stopgap.
- **Why the data-stream protocol (Option 1).** It is the canonical, supported path for the stack
  already in use (`ai@4.3.19`, `@mastra/core@0.24`). The installed Mastra `agent.streamLegacy()`
  returns the AI SDK v4 `StreamTextResult`, which already exposes `toDataStreamResponse()` — so the
  server can switch from manual text teeing to the data protocol **without** moving to `streamVNext`.
  On the client, `@ai-sdk/react`'s `useChat` consumes that protocol and surfaces tool-invocation
  parts, which we render as cards. This is a bounded, well-trodden change that also benefits every
  other write tool.

---

## Requirements

### 1. Structured chat transport

- **1.1** The chat endpoint MUST stream using the AI SDK data-stream protocol (text parts + tool
  parts) instead of the current raw `text/plain` token stream.
- **1.2** The client MUST consume that protocol and expose, per assistant message, its ordered
  parts: text segments and tool invocations (with their call args and results).
- **1.3** Existing behaviour MUST be preserved: streaming token-by-token rendering, markdown
  rendering of assistant text, read-aloud (SpeechSynthesis), auto-scroll, and the voice-recorder
  composer.
- **1.4** The change MUST NOT alter the request contract in a way that breaks in-flight clients
  beyond a single coordinated deploy (client + server ship together — see Non-functional 6.2).

### 2. Tool-driven confirm card (activity draft)

- **2.1** When the assistant calls `addActivity` with `confirmed=false`, the returned draft MUST be
  rendered inline as an **editable confirm card**, not as prose.
- **2.2** The card MUST let the athlete edit every draft field (sport, date/time, duration,
  distance, HR, pace, RPE, notes, strength), reusing the same validation as the Activities-page
  form.
- **2.3** The card MUST require date/time confirmation before Save when the draft is flagged
  `dateTimeNeedsConfirmation` (consistent with the direct-entry flow).
- **2.4** Save MUST persist via the existing `POST /api/activities` (shared insert + dedup path),
  NOT by asking the model to call the tool again. The chat tool's confirmed-write branch becomes a
  fallback, not the primary save path for the card.
- **2.5** On a dedup `409`, the card MUST surface the duplicate and offer "Save anyway" (force),
  matching the direct-entry UX.
- **2.6** After a successful save the card MUST show a saved state (and a link to the activity) and
  become non-editable; the conversation continues normally.
- **2.7** Discard MUST dismiss the card without writing; the athlete can keep chatting.

### 3. Persistence & history

- **3.1** Assistant messages that contain tool interactions MUST still be persisted to
  `coaching_messages` and MUST re-render correctly when chat history is reloaded (Req 1.3 parity).
- **3.2** Reloaded history MUST NOT re-execute tools or re-save activities. A tool card restored
  from history is display-only (reflecting its final state), never a live action.
- **3.3** The history contract (`GET /api/ai/chat/history`) MUST continue to return messages that
  the client can render; any new persisted structure MUST be backward-compatible with existing
  rows (which store plain `content` text).

### 4. Scope of tools rendered

- **4.1** v1 MUST render a card for `addActivity` only. All other tools
  (`getRecentActivities`, `getBestSplits`, `updateSessionStatus`, …) MUST continue to work exactly
  as today (their results feed the model; no card required).
- **4.2** The client rendering MUST degrade gracefully for any tool without a registered card:
  render nothing user-facing for that tool part (the assistant's text still conveys the outcome).

### 5. Read-aloud & accessibility

- **5.1** Read-aloud MUST speak only the assistant's text parts, not card contents/JSON.
- **5.2** The confirm card MUST be keyboard-navigable and screen-reader labelled (same bar as the
  Activities-page form).

### 6. Non-functional

- **6.1** No regression in first-token latency or streaming smoothness versus the current text
  stream.
- **6.2** Because the transport changes on both ends, client and server MUST be deployed together.
  The change is coordinated, single-repo, single-deploy — document this as a release note.
- **6.3** The migration MUST be reversible: keep the change isolated enough that reverting the chat
  route + chat client restores the prior text-stream behaviour without data migration.

---

## Out of Scope (v1)

- Cards for tools other than `addActivity` (follow-on; `updateSessionStatus` is the obvious next).
- Switching the agent to Mastra `streamVNext`/`stream()` (not required — `streamLegacy` already
  yields a data-stream-capable result; revisit only if we later need vNext features).
- Multi-tool cards in a single turn, or editing a card after save.
- Any change to the parser, draft schema, or create/dedup endpoints (all reused unchanged).
