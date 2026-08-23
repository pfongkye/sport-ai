# Interactive Tool UI in Coach Chat — Implementation Tasks

> Transport upgrade (AI SDK data-stream) + one confirm card for `addActivity`. Reuses the parser,
> draft schema, `POST /api/activities`, `insertManualActivity`, and dedup from
> `voice-freeform-activity-logging`. Client and server ship together (coupled deploy).

---

## Phase 0 — De-risk the dependency

### Task 0.1 — Confirm AI SDK React compatibility
- [ ] Verify/add `@ai-sdk/react` pinned to the version compatible with `ai@4.3.19`. Confirm its
      `useChat` exposes `message.parts` with `tool-invocation` parts in this line.
- [ ] Spike: a throwaway route returning `streamLegacy(...).toDataStreamResponse()` + a minimal
      `useChat` client that logs `messages[].parts`, to confirm text + tool parts arrive. Remove
      after validating.

---

## Phase 1 — Server transport

### Task 1.1 — Switch chat route to data-stream
- [ ] In `app/src/app/api/ai/chat/route.ts`, keep auth/RAG/user-message-persist/window logic; keep
      `agent.streamLegacy(llmMessages)`.
- [ ] Replace the manual `ReadableStream` text tee with `return result.toDataStreamResponse({...})`.
- [ ] Move assistant-message persistence (text + embedding, admin client, `metadata.kind:'chat'`)
      into `onFinish`. Ensure no double-persist; verify behaviour on client abort.
- [ ] Add `getErrorMessage` for readable stream errors.
- [ ] Accept the `useChat` request body shape; still derive `lastUser` and apply
      `MAX_CONTEXT_MESSAGES` / `MAX_MESSAGE_CHARS`.

---

## Phase 2 — Client transport

### Task 2.1 — Adopt useChat in chat-interface
- [ ] Replace the `getReader()` loop + local message state with `useChat({ api:'/api/ai/chat' })`.
- [ ] Pass a custom `fetch` (or headers) that applies the `http()` ngrok header in tunnel mode.
- [ ] Seed `initialMessages` from `GET /api/ai/chat/history` mapped to the useChat message shape;
      ensure stable ids.
- [ ] Render `message.parts`: text → existing markdown bubble; preserve typing indicator (from
      `status`), auto-scroll, and the VoiceRecorder composer.
- [ ] Read-aloud: speak concatenated text parts only.

---

## Phase 3 — Confirm card

### Task 3.1 — Extract shared draft form
- [ ] Extract the draft-phase form from `add-activity-by-voice.tsx` into a reusable
      `ActivityDraftForm` (fields, unit conversions, validation, date/time gate, 409 handling) so
      the page flow and the chat card share one implementation.

### Task 3.2 — ActivityDraftCard
- [ ] Create `app/src/components/chat/activity-draft-card.tsx` wrapping `ActivityDraftForm`.
- [ ] Props: `draft`, `possibleDuplicate?`, `onSaved(id)`, `onDiscard()`.
- [ ] Save → `http('/api/activities', POST)`; handle 201 (saved state + link) and 409 (force).
- [ ] Keyboard-navigable + ARIA labelled.

### Task 3.3 — Wire card into chat rendering
- [ ] In chat-interface, for `tool-invocation` parts with `toolName==='addActivity'` and a result
      draft, render `<ActivityDraftCard>`. Unknown tools render nothing.
- [ ] Saving via the card MUST NOT prompt the model to re-call the tool (card owns the write).

---

## Phase 4 — History parity

### Task 4.1 — History rendering
- [ ] Confirm reloaded history renders prior turns as text (minimum option) and executes no tools.
- [ ] (Optional) Persist a compact `metadata.tools` summary and render a static, read-only card on
      reload. Keep additive (jsonb), display-only.

---

## Phase 5 — Verification

### Task 5.1 — Tests
- [ ] Unit: ActivityDraftCard save (happy/409-force/validation/date-gate).
- [ ] Integration: mocked data stream with `addActivity(confirmed:false)` → card renders → Save
      hits `POST /api/activities` → saved state.
- [ ] Regression: plain Q&A streams text + markdown; read-aloud text-only; history reload executes
      nothing.

### Task 5.2 — Build, lint, manual
- [ ] `npm run build` / `npm run lint` in `app/` (in-container per the dev setup).
- [ ] Manual: "add my run…" → edit → save → link; duplicate → "save anyway"; chat over ngrok.
- [ ] Release note: client+server must deploy together (coupled transport change).
