'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { http } from '@/lib/http'
import { cn } from '@/lib/utils'

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
  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Load prior conversation
  useEffect(() => {
    http('/api/ai/chat/history?limit=50')
      .then((r) => (r.ok ? r.json() : { messages: [] }))
      .then((d) => setMessages(d.messages ?? []))
      .catch(() => setMessages([]))
      .finally(() => setLoadingHistory(false))
  }, [])

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  async function send(text: string) {
    const trimmed = text.trim()
    if (!trimmed || streaming) return

    const userMsg: Msg = { id: `u-${Date.now()}`, role: 'user', content: trimmed }
    const assistantId = `a-${Date.now()}`
    const nextMessages = [...messages, userMsg]

    setMessages([...nextMessages, { id: assistantId, role: 'assistant', content: '' }])
    setInput('')
    setStreaming(true)

    try {
      const res = await http('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
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
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error'
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, content: `⚠️ ${message}` } : m))
      )
    } finally {
      setStreaming(false)
    }
  }

  const isEmpty = !loadingHistory && messages.length === 0

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 md:px-6 py-4">
        <div className="max-w-2xl mx-auto space-y-4">
          {loadingHistory && (
            <p className="text-center text-sm text-[var(--muted-foreground)]">Loading…</p>
          )}

          {isEmpty && (
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
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send(input)
              }
            }}
            placeholder="Ask your coach…"
            rows={1}
            className="flex-1 resize-none rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)] max-h-32"
          />
          <button
            type="submit"
            disabled={streaming || !input.trim()}
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
