# Interactive Tool UI in Coach Chat — Design

## Goal

Give the coach chat a structured transport so tool calls/results reach the client, and render the
`addActivity` draft as an inline editable confirm card. Reuse everything from the
`voice-freeform-activity-logging` feature (parser, `activityDraftSchema`, `POST /api/activities`,
`insertManualActivity`, dedup). This is a transport change plus one card component — not a rewrite.

---

## Key technical finding (what makes this cheap)

The installed `@mastra/core@0.24` `Agent.streamLegacy(messages)` returns the AI SDK **v4**
`StreamTextResult` (confirmed in `node_modules/@mastra/core/dist/agent/agent.d.ts`, lines ~644-648).
That object already exposes `.toDataStreamResponse()` (and `.toUIMessageStreamResponse()`), which
emit the AI SDK **data-stream protocol** — text deltas plus tool-call and tool-result parts.

Consequence: we do **not** need to migrate the agent to `streamVNext`/`stream()`. We keep
`streamLegacy`, stop manually teeing `result.textStream` to a `text/plain` body, and instead return
`result.toDataStreamResponse(...)`. On the client we replace the hand-rolled `getReader()` loop with
`useChat` from `@ai-sdk/react`, which parses that protocol and gives us `message.parts` including
`tool-invocation` entries. That is the whole transport change.

> Verify at implementation time that `@ai-sdk/react` is on a version compatible with `ai@4.3.19`.
> If it isn't already a dependency, add it pinned to the v4-compatible line. This is the one
> external unknown; everything else is in-repo.

---

## How this fits the existing code (grounding)

- **Server:** `app/src/app/api/ai/chat/route.ts` currently builds the agent, calls
  `agent.streamLegacy(llmMessages)`, then tees `result.textStream` into a `ReadableStream` with
  `Content-Type: text/plain`, accumulating `full` to persist the assistant reply via the admin
  client after the stream closes. RAG retrieval, the user-message insert (with embedding), and the
  20-message window all stay.
- **Client:** `app/src/components/chat/chat-interface.tsx` manages `messages: {id,role,content}[]`,
  POSTs `{messages:[{role,content}]}`, reads the raw stream via `res.body.getReader()`, appends
  decoded text to one bubble, renders assistant text with `react-markdown`, does SpeechSynthesis
  read-aloud, auto-scroll, and hosts the `<VoiceRecorder>` composer.
- **History:** `GET /app/src/app/api/ai/chat/history/route.ts` returns `coaching_messages` rows
  filtered to `metadata->>kind = 'chat'`, shape `{id, role, content, metadata, created_at}`.
- **Tool:** `addActivity` in `app/src/lib/ai/tools/index.ts` already returns
  `{ saved:false, needsConfirmation:true, draft, possibleDuplicate? }` on the unconfirmed call —
  exactly the payload the card needs. Its confirmed-write branch stays as a fallback.
- **Reused save path:** `POST /api/activities` (validate → `findLikelyDuplicate` → 409/insert) and
  `insertManualActivity`. The card saves through this, not through the model.

---

## Architecture

```
Client (useChat, @ai-sdk/react)
   │  POST /api/ai/chat  { messages: UIMessage[] }
   ▼
/api/ai/chat  (Node runtime)
   │  auth → RAG retrieve + persist user msg (unchanged)
   │  agent.streamLegacy(llmMessages)            ← unchanged call
   │  return result.toDataStreamResponse({       ← CHANGED (was manual text tee)
   │     onFinish: persist assistant message      ← moved from stream 'finally'
   │  })
   ▼
Data-stream protocol (text parts + tool parts)
   ▼
Client renders message.parts:
   • text part      → markdown bubble (as today)
   • tool 'addActivity' (state=result, confirmed:false)
        → <ActivityDraftCard draft=… />  (edit → POST /api/activities → saved state)
   • any other tool → render nothing (assistant text carries it)
```

The card's Save calls `POST /api/activities` directly (shared path). The model is not asked to call
the tool a second time — this avoids a fragile "model must now call confirmed=true" round-trip and
keeps the write behind the same validated endpoint used everywhere else (Req 2.4).

---

## Server changes — `/api/ai/chat/route.ts`

Replace the manual `ReadableStream` tee with the data-stream response. Persistence moves into the
result's `onFinish` callback (which receives the final text and tool steps):

```ts
const result = await agent.streamLegacy(llmMessages)

return result.toDataStreamResponse({
  getErrorMessage: (e) => (e instanceof Error ? e.message : 'AI request failed'),
  async onFinish({ text /*, toolCalls, toolResults, ... */ }) {
    if (text.trim()) {
      const emb = await embedForStorage(text, aiSettings.userApiKey)
      await admin.from('coaching_messages').insert({
        user_id: user.id, role: 'assistant', content: text,
        metadata: { kind: 'chat' },       // optionally include a compact tool summary
        embedding: emb as any,
      })
    }
  },
})
```

Notes:
- The request body shape changes to what `useChat` sends (`messages: UIMessage[]`). Keep the
  server tolerant: map incoming messages to `CoreMessage`s the same way, still derive `lastUser`
  for RAG/persistence, still apply the 20-message window and per-message char cap.
- We persist the assistant's **text** into `content` as today (keeps history + RAG embeddings
  working). If we want cards to reappear in history, also store a compact tool summary in
  `metadata` (see Persistence below) — additive, no column change.
- `runtime='nodejs'` and `maxDuration` stay.

## Client changes — `chat-interface.tsx`

Adopt `useChat`:

```ts
const { messages, input, handleInputChange, handleSubmit, status, setMessages, append } =
  useChat({ api: '/api/ai/chat', initialMessages, /* fetch: http-compatible wrapper */ })
```

- **Custom fetch/headers:** the app routes all calls through `http()` to add the ngrok header. Pass
  a `fetch` option to `useChat` that applies the same header (or set `headers` when tunnelling), so
  tunnel mode keeps working (see Pitfalls).
- **Rendering:** iterate `message.parts`. For `type:'text'` render the markdown bubble (existing
  styles). For `type:'tool-invocation'` with `toolName==='addActivity'` render `<ActivityDraftCard>`
  from the tool result's `draft`. Unknown tools render nothing.
- **Read-aloud:** speak only concatenated text parts (Req 5.1) — do not speak tool JSON.
- **Auto-scroll / typing indicator:** derive from `status` (`streaming`/`submitted`) instead of the
  local `streaming` flag.
- **Composer & VoiceRecorder:** unchanged; VoiceRecorder still appends into the input.

## New component — `ActivityDraftCard`

`app/src/components/chat/activity-draft-card.tsx`. Essentially the draft-phase UI already built in
`add-activity-by-voice.tsx`, extracted/adapted:
- Props: `draft: ActivityDraft`, `possibleDuplicate?`, `onSaved(id)`, `onDiscard()`.
- Local editable form (same fields, same unit conversions), date/time gating, inline validation.
- Save → `http('/api/activities', { POST, body: {...draft, force?} })`; handle `409` → show
  duplicate + "Save anyway".
- On success → saved state with a link to `/activities/:id`; card becomes read-only.
- Recommend extracting the shared form into one component used by BOTH `add-activity-by-voice` and
  this card, so the two never drift (see Tasks).

## Persistence of tool cards in history (Req 3.1–3.2)

Two acceptable levels:
- **Minimum (v1):** persist only the assistant text (as today). On history reload, the turn shows
  the assistant's prose; the live card existed only during the session. Simple, fully backward
  compatible, satisfies "history renders correctly" and "no re-execution" trivially.
- **Nicer (optional):** also store a compact descriptor in `metadata` (e.g.
  `metadata.tools = [{ name:'addActivity', status:'saved'|'discarded', activityId? }]`). On reload,
  render a static, non-interactive summary card. Still additive (jsonb `metadata`), no migration,
  and explicitly display-only so nothing re-executes.

Pick minimum for v1 unless the static card is desired; either way, restored cards are never live
(Req 3.2).

---

## Breaking changes & things to be careful of

1. **Coupled client/server deploy (the big one).** The request/response contract changes on both
   ends simultaneously. A half-deploy (new client + old text route, or vice-versa) breaks chat.
   Ship both together; call it out in the release note (Req 6.2). Keep the diff isolated to the
   chat route + chat client so a revert restores the old behaviour with no data migration (Req 6.3).

2. **`http()` / ngrok header.** `useChat` uses its own `fetch`. If we don't pass a custom `fetch`
   that adds `ngrok-skip-browser-warning` in tunnel mode, dev-over-ngrok chat will hit the ngrok
   interstitial and fail. Wire the tunnel header into `useChat`'s `fetch`/`headers`.

3. **Persistence timing moves.** Today the assistant message is saved in the stream's `finally`
   using the admin client (so it survives the request lifecycle). That logic must move into
   `toDataStreamResponse`'s `onFinish`. Verify `onFinish` fires on client-abort/disconnect the way
   we want; keep using the admin client. Don't double-persist (remove the old tee/accumulate).

4. **History reload must not re-trigger tools.** `initialMessages` restored from
   `coaching_messages` are text (or static summaries). Ensure restored tool parts are display-only
   and that `useChat` doesn't attempt to resume/execute them (Req 3.2). With the "minimum"
   persistence option this is automatic (no tool parts restored).

5. **`@ai-sdk/react` version compatibility.** Must match `ai@4` (UIMessage/parts shape differs
   between AI SDK v4 and v5). Pin it. This is the only out-of-repo dependency risk — validate early.

6. **Message id / dedup on reload.** The current client generates its own ids; `useChat` manages
   ids. When seeding `initialMessages` from history, map to the shape `useChat` expects and ensure
   ids are stable so React keys don't thrash.

7. **RAG/window logic.** Keep deriving `lastUser` and applying `MAX_CONTEXT_MESSAGES` /
   `MAX_MESSAGE_CHARS` against the incoming `useChat` messages — don't regress the token-cost guard.

8. **Multi-step tool turns.** `toDataStreamResponse` can stream a tool call, its result, and then
   more assistant text in one turn. Make sure the client renders parts in order (text/card/text) and
   that `onFinish` persists the final assembled text.

9. **Error surfacing.** The old client special-cased non-OK JSON errors. With `useChat`, use its
   `error` state + `getErrorMessage` in `toDataStreamResponse` so failures still show a readable
   message, not a silent dead stream.

10. **Read-aloud scope.** Ensure `speak()` receives only text parts; feeding it the whole message
    (incl. tool data) would read JSON aloud.

---

## Testing strategy

- Unit: `ActivityDraftCard` save (happy path, `409` → force, validation block, date/time gate).
- Integration: mock the agent to emit a data stream with an `addActivity(confirmed:false)` tool
  result; assert the client renders a card, Save calls `POST /api/activities`, and saved state
  shows.
- Regression: plain Q&A turn still streams text + renders markdown; read-aloud speaks text only;
  history reload renders prior turns and executes nothing.
- Manual: full chat flow "add my run…" → card → edit → save → link; and a duplicate → "save anyway".
- Manual (tunnel): confirm chat works over ngrok (custom `fetch` header).
