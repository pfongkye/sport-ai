'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { http } from '@/lib/http'
import { cn } from '@/lib/utils'
import { VoiceRecorder } from './voice-recorder'
import { SessionBar } from './session-bar'
import { SessionList, type ChatSession } from './session-list'
import { KeptNotes, type CoachMemory } from './kept-notes'

interface Msg {
  id: string
  role: 'user' | 'assistant'
  content: string
}

const SUGGESTIONS = [
  'How was my last run?',
  "What should I do today?",
  'Am I ready for a hard session?',
  'How is my training load trending?',
]

export function ChatInterface() {
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [speakEnabled, setSpeakEnabled] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-grow the composer textarea to fit its content (capped by CSS max-height).
  const autosize = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [])

  // Resize whenever the value changes (typing, transcript insert, or clear on send).
  useEffect(() => {
    autosize()
  }, [input, autosize])

  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [memories, setMemories] = useState<CoachMemory[]>([])
  const [status, setStatus] = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)
  const loadSeq = useRef(0)

  const loadHistory = useCallback(async (id: string) => {
    const seq = ++loadSeq.current
    setLoadingHistory(true)
    setMessages([])
    try {
      const r = await http(`/api/ai/chat/history?limit=50&sessionId=${encodeURIComponent(id)}`)
      const d = r.ok ? await r.json() : { messages: [] }
      if (seq !== loadSeq.current) return
      setMessages(d.messages ?? [])
      // Jump to the latest message instantly.
      requestAnimationFrame(() => {
        const el = scrollRef.current
        if (el) el.scrollTop = el.scrollHeight
      })
    } catch {
      if (seq === loadSeq.current) setMessages([])
    } finally {
      if (seq === loadSeq.current) setLoadingHistory(false)
    }
  }, [])

  const createSession = useCallback(async (): Promise<ChatSession | null> => {
    try {
      const r = await http('/api/ai/chat/sessions', { method: 'POST' })
      if (!r.ok) return null
      return (await r.json()).session as ChatSession
    } catch {
      return null
    }
  }, [])

  const refreshSessions = useCallback(async () => {
    try {
      const r = await http('/api/ai/chat/sessions')
      if (r.ok) setSessions((await r.json()).sessions ?? [])
    } catch {
      // keep the current list
    }
  }, [])

  // Load chats on mount; start one if the athlete has none. Then load the active chat.
  useEffect(() => {
    let cancelled = false
    async function init() {
      let list: ChatSession[] = []
      try {
        const r = await http('/api/ai/chat/sessions')
        if (r.ok) list = (await r.json()).sessions ?? []
      } catch {
        // fall through to creating one
      }
      if (list.length === 0) {
        const created = await createSession()
        if (created) list = [created]
      }
      if (cancelled) return
      setSessions(list)
      if (list[0]) {
        setSessionId(list[0].id)
        void loadHistory(list[0].id)
      } else {
        setLoadError('Could not load your chats. Reload the page to try again.')
        setLoadingHistory(false)
      }
    }
    void init()
    return () => {
      cancelled = true
    }
  }, [createSession, loadHistory])

  // Kept notes load when the panel is first opened.
  const memoriesLoaded = useRef(false)
  useEffect(() => {
    if (!panelOpen || memoriesLoaded.current) return
    memoriesLoaded.current = true
    http('/api/ai/chat/memories')
      .then((r) => (r.ok ? r.json() : { memories: [] }))
      .then((d) => setMemories(d.memories ?? []))
      .catch(() => {
        memoriesLoaded.current = false
      })
  }, [panelOpen])

  function selectSession(id: string) {
    if (streaming || id === sessionId) {
      setPanelOpen(false)
      return
    }
    setSessionId(id)
    setPanelOpen(false)
    void loadHistory(id)
    setStatus('Chat opened.')
  }

  async function newChat() {
    if (streaming) return
    const created = await createSession()
    if (!created) {
      setStatus('Could not start a new chat.')
      return
    }
    setSessions((prev) => [created, ...prev])
    setSessionId(created.id)
    loadSeq.current++
    setMessages([])
    setLoadingHistory(false)
    setPanelOpen(false)
    setStatus('New chat started.')
  }

  /** Resolves to an error message, or null on success. */
  async function deleteSession(id: string, keepSummary: boolean): Promise<string | null> {
    setStatus(keepSummary ? 'Summarizing the chat…' : 'Deleting the chat…')
    try {
      const r = await http(`/api/ai/chat/sessions/${id}?keepHistory=${keepSummary}`, { method: 'DELETE' })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        const msg = d.error ?? 'Could not delete the chat.'
        setStatus(keepSummary ? `Could not keep a summary. The chat was not deleted. ${msg}` : msg)
        return keepSummary
          ? `${msg} The chat was not deleted. You can try again or choose Delete everything.`
          : msg
      }
      const remaining = sessions.filter((s) => s.id !== id)
      setSessions(remaining)
      if (d.memory) setMemories((prev) => [d.memory as CoachMemory, ...prev])
      setStatus(keepSummary ? 'Chat deleted. A summary was added to Kept notes.' : 'Chat deleted.')
      if (id === sessionId) {
        if (remaining[0]) {
          setSessionId(remaining[0].id)
          void loadHistory(remaining[0].id)
        } else {
          const created = await createSession()
          if (created) {
            setSessions([created])
            setSessionId(created.id)
            loadSeq.current++
            setMessages([])
            setLoadingHistory(false)
          } else {
            setSessionId(null)
            setLoadError('Could not start a new chat. Reload the page to try again.')
          }
        }
      }
      return null
    } catch {
      setStatus('Could not delete the chat.')
      return 'Could not delete the chat.'
    }
  }

  // Restore read-aloud preference
  useEffect(() => {
    // Must run after mount: localStorage is unavailable during SSR, and reading it in the
    // initial state would cause a hydration mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSpeakEnabled(localStorage.getItem('coach:speak') === '1')
  }, [])
  useEffect(() => {
    localStorage.setItem('coach:speak', speakEnabled ? '1' : '0')
    if (!speakEnabled && typeof window !== 'undefined') window.speechSynthesis?.cancel()
  }, [speakEnabled])

  // Speak text via the browser's SpeechSynthesis (no API cost).
  const speak = useCallback(
    (text: string) => {
      if (!speakEnabled || typeof window === 'undefined' || !window.speechSynthesis) return
      // Strip markdown-ish characters so it reads cleanly.
      const clean = text.replace(/[#*_`>]/g, '').replace(/\s+/g, ' ').trim()
      if (!clean) return
      window.speechSynthesis.cancel()
      const u = new SpeechSynthesisUtterance(clean)
      u.rate = 1.05
      u.lang = 'en-US' // app is English-only for now; TODO(i18n): user language
      window.speechSynthesis.speak(u)
    },
    [speakEnabled]
  )

  // Keep the view pinned to the bottom, but only if the user is already near it.
  // If they've scrolled up to read history, don't yank them back down.
  const isNearBottom = useCallback(() => {
    const el = scrollRef.current
    if (!el) return true
    return el.scrollHeight - el.scrollTop - el.clientHeight < 120
  }, [])

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = 'smooth') => {
      // Scroll the container directly (not scrollIntoView) so streaming token
      // updates don't fire overlapping smooth animations that jitter.
      const el = scrollRef.current
      if (el) el.scrollTop = el.scrollHeight
      if (behavior === 'smooth') bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    },
    []
  )

  // During streaming, keep the bottom pinned instantly (no animation) and only
  // when the user hasn't scrolled away. Smooth-scroll only happens on send.
  useEffect(() => {
    if (streaming) {
      if (isNearBottom()) scrollToBottom('auto')
    }
  }, [messages, streaming, isNearBottom, scrollToBottom])

  async function send(text: string) {
    const trimmed = text.trim()
    if (!trimmed || streaming || !sessionId) return

    // Stop any in-progress read-aloud when the user sends a new message.
    if (typeof window !== 'undefined') window.speechSynthesis?.cancel()

    const userMsg: Msg = { id: `u-${Date.now()}`, role: 'user', content: trimmed }
    const assistantId = `a-${Date.now()}`
    const nextMessages = [...messages, userMsg]

    setMessages([...nextMessages, { id: assistantId, role: 'assistant', content: '' }])
    setInput('')
    setStreaming(true)
    // One smooth scroll to bring the new user message + incoming reply into view.
    requestAnimationFrame(() => scrollToBottom('smooth'))

    try {
      const res = await http('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          messages: nextMessages.map((m) => ({ role: m.role, content: m.content })),
        }),
      })

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: 'Request failed' }))
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: `⚠️ ${err.error ?? `Error ${res.status}`}` }
              : m
          )
        )
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let acc = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        acc += decoder.decode(value, { stream: true })
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, content: acc } : m))
        )
      }
      if (!acc.trim()) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: '⚠️ No response. Try again.' } : m
          )
        )
      } else {
        speak(acc)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error'
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, content: `⚠️ ${message}` } : m))
      )
    } finally {
      setStreaming(false)
      void refreshSessions()
    }
  }

  const isEmpty = !loadingHistory && messages.length === 0

  return (
    <div className="flex flex-col h-full">
      <SessionBar
        title={sessions.find((x) => x.id === sessionId)?.title ?? 'New chat'}
        open={panelOpen}
        busy={streaming}
        canCreate={messages.length > 0}
        onToggle={() => setPanelOpen((o) => !o)}
        onNew={() => void newChat()}
      />
      <div role="status" aria-live="polite" className="sr-only">
        {status}
      </div>
      {panelOpen && (
        <div
          id="chat-sessions-panel"
          className="shrink-0 max-h-[55%] overflow-y-auto border-b border-[var(--border)] bg-[var(--card)] px-4 md:px-6 py-3"
        >
          <div className="max-w-2xl mx-auto space-y-5">
            <section aria-label="Chats" className="space-y-2">
              <h2 className="text-sm font-semibold text-[var(--foreground)]">Chats</h2>
              <SessionList
                sessions={sessions}
                activeId={sessionId}
                busy={streaming}
                onSelect={selectSession}
                onDelete={deleteSession}
              />
            </section>
            <KeptNotes
              memories={memories}
              onChange={(next, message) => {
                setMemories(next)
                setStatus(message)
              }}
            />
          </div>
        </div>
      )}
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 md:px-6 py-4">
        <div className="max-w-2xl mx-auto space-y-4">
          {loadingHistory && (
            <p className="text-center text-sm text-[var(--muted-foreground)]">Loading…</p>
          )}

          {loadError && (
            <p role="alert" className="text-center text-sm text-[var(--destructive)]">
              {loadError}
            </p>
          )}

          {isEmpty && !loadError && (
            <div className="text-center py-10 space-y-4">
              <p className="text-4xl" aria-hidden>
                🤖
              </p>
              <div>
                <p className="font-medium text-[var(--foreground)]">Ask your AI coach</p>
                <p className="text-sm text-[var(--muted-foreground)] mt-1">
                  It knows your activities, training load, and goal.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 justify-center pt-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="rounded-full border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) => (
            <div
              key={m.id}
              className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}
            >
              <div
                className={cn(
                  'rounded-2xl px-4 py-2.5 max-w-[85%] text-sm',
                  m.role === 'user'
                    ? 'bg-[var(--primary)] text-white'
                    : 'bg-[var(--muted)] text-[var(--foreground)]'
                )}
              >
                {m.role === 'assistant' ? (
                  m.content ? (
                    <div className="markdown [&_p]:my-1.5 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_ul]:my-1.5 [&_ul]:pl-4 [&_ul]:list-disc [&_ol]:my-1.5 [&_ol]:pl-4 [&_ol]:list-decimal [&_li]:my-0.5 [&_strong]:font-semibold [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:font-semibold [&_code]:rounded [&_code]:bg-black/10 [&_code]:px-1 [&_code]:py-0.5 [&_a]:underline">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                    </div>
                  ) : (
                    <TypingDots />
                  )
                ) : (
                  m.content
                )}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Composer */}
      <div className="border-t border-[var(--border)] bg-[var(--card)] px-4 md:px-6 py-3">
        <form
          className="max-w-2xl mx-auto flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            send(input)
          }}
        >
          <VoiceRecorder
            disabled={streaming}
            onTranscript={(text) => {
              if (!text) return
              // Append to the input so the athlete can review/edit before sending.
              setInput((prev) => (prev ? `${prev} ${text}` : text))
            }}
          />
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send(input)
              }
            }}
            placeholder="Ask your coach, or tap the mic…"
            rows={1}
            className="flex-1 resize-none rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-[var(--ring)] max-h-40 overflow-y-auto"
          />
          <button
            type="button"
            onClick={() => setSpeakEnabled((s) => !s)}
            aria-pressed={speakEnabled}
            aria-label={speakEnabled ? 'Disable read-aloud' : 'Enable read-aloud'}
            title={speakEnabled ? 'Read-aloud on' : 'Read-aloud off'}
            className={cn(
              'shrink-0 flex items-center justify-center size-10 rounded-xl transition-colors',
              speakEnabled
                ? 'bg-[var(--primary)]/15 text-[var(--primary)]'
                : 'bg-[var(--muted)] text-[var(--muted-foreground)] hover:bg-[var(--border)]'
            )}
          >
            {speakEnabled ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-5" aria-hidden>
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-5" aria-hidden>
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <line x1="23" y1="9" x2="17" y2="15" />
                <line x1="17" y1="9" x2="23" y2="15" />
              </svg>
            )}
          </button>
          <button
            type="submit"
            disabled={streaming || !sessionId || !input.trim()}
            className="shrink-0 flex items-center justify-center size-10 rounded-xl bg-[var(--primary)] text-white disabled:opacity-40 transition-opacity"
            aria-label="Send"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-5" aria-hidden>
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </form>
      </div>
    </div>
  )
}

function TypingDots() {
  return (
    <span className="inline-flex gap-1 py-1" aria-label="Coach is typing">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-1.5 rounded-full bg-[var(--muted-foreground)] animate-bounce"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </span>
  )
}
