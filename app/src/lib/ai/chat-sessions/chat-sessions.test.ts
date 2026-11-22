import { describe, it, expect, vi } from 'vitest'
import { makeFakeSupabase } from '@/lib/plan/__fixtures__/fake-supabase'
import { formatCoachMemories } from './memories'
import { buildSummaryPrompt, buildTranscript, MAX_TRANSCRIPT_CHARS } from './summarize'
import { deleteChatSession } from './delete-session'
import { titleFromMessage } from './sessions'

describe('formatCoachMemories', () => {
  const mem = (i: number, summary = `fact ${i}`) => ({ title: `Chat ${i}`, summary, created_at: '2026-01-02T00:00:00Z' })
  it('returns empty string with nothing to inject', () => {
    expect(formatCoachMemories([])).toBe('')
    expect(formatCoachMemories([mem(1, '   ')])).toBe('')
  })
  it('limits to 5 items by default', () => {
    const out = formatCoachMemories(Array.from({ length: 8 }, (_, i) => mem(i)))
    expect(out.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(5)
    expect(out).toContain('(2026-01-02)')
  })
  it('caps each item and the total', () => {
    const one = formatCoachMemories([mem(1, 'x'.repeat(5000))])
    expect(one.length).toBeLessThan(1400)
    const many = formatCoachMemories(Array.from({ length: 5 }, (_, i) => mem(i, 'y'.repeat(1200))))
    const body = many.split('\n').slice(1).join('\n')
    expect(body.length).toBeLessThanOrEqual(3000)
  })
})

describe('summary prompt', () => {
  it('asks for durable facts only and labels speakers', () => {
    const { system, prompt } = buildSummaryPrompt([
      { role: 'user', content: 'My knee hurts' },
      { role: 'assistant', content: 'Rest it' },
    ])
    expect(system).toMatch(/injuries/)
    expect(system).toMatch(/1200/)
    expect(prompt).toContain('Athlete: My knee hurts')
    expect(prompt).toContain('Coach: Rest it')
  })
  it('keeps the tail of a long transcript', () => {
    const t = buildTranscript([{ role: 'user', content: 'a'.repeat(40000) + 'END' }])
    expect(t.length).toBe(MAX_TRANSCRIPT_CHARS)
    expect(t.endsWith('END')).toBe(true)
  })
})

describe('titleFromMessage', () => {
  it('collapses whitespace and caps at 60 chars', () => {
    expect(titleFromMessage('  hello\n  world ')).toBe('hello world')
    expect(titleFromMessage('z'.repeat(100)).length).toBe(60)
  })
})

const seed = () =>
  makeFakeSupabase({
    tables: {
      coach_sessions: [
        { id: 's1', user_id: 'u1', title: 'Knee talk' },
        { id: 's2', user_id: 'u1', title: 'Other' },
        { id: 's3', user_id: 'u2', title: 'Foreign' },
      ],
      coaching_messages: [
        { id: 'm1', user_id: 'u1', session_id: 's1', role: 'user', content: 'hi', created_at: '2026-01-01T10:00:00Z', embedding: 'e' },
        { id: 'm2', user_id: 'u1', session_id: 's1', role: 'assistant', content: 'hello', created_at: '2026-01-01T10:01:00Z', embedding: 'e' },
        { id: 'm3', user_id: 'u1', session_id: 's2', role: 'user', content: 'keep me', created_at: '2026-01-02T10:00:00Z' },
        { id: 'm4', user_id: 'u2', session_id: 's3', role: 'user', content: 'foreign', created_at: '2026-01-02T10:00:00Z' },
      ],
    },
  })

describe('deleteChatSession', () => {
  it('keep: summarizes, saves the memory, then deletes only that session', async () => {
    const f = seed()
    const summarize = vi.fn().mockResolvedValue('Knee injury, rest.')
    const r = await deleteChatSession(f.client, 'u1', 's1', { keepHistory: true, summarize })
    expect(r.ok).toBe(true)
    expect(summarize).toHaveBeenCalledTimes(1)
    expect(summarize.mock.calls[0][0]).toHaveLength(2)
    expect(f.tables.coach_memories).toHaveLength(1)
    expect(f.tables.coach_memories[0]).toMatchObject({ user_id: 'u1', title: 'Knee talk', summary: 'Knee injury, rest.', message_count: 2 })
    expect(f.tables.coach_sessions.map((s) => s.id)).toEqual(['s2', 's3'])
    expect(f.tables.coaching_messages.map((m) => m.id)).toEqual(['m3', 'm4'])
  })

  it('no keep: never calls summarize, removes all messages', async () => {
    const f = seed()
    const summarize = vi.fn()
    const r = await deleteChatSession(f.client, 'u1', 's1', { keepHistory: false, summarize })
    expect(r).toEqual({ ok: true, deleted: 's1', memory: null })
    expect(summarize).not.toHaveBeenCalled()
    expect(f.tables.coach_memories ?? []).toHaveLength(0)
    expect(f.tables.coaching_messages.some((m) => m.session_id === 's1')).toBe(false)
    expect(f.tables.coaching_messages).toHaveLength(2)
  })

  it('summary failure deletes nothing', async () => {
    const f = seed()
    const r = await deleteChatSession(f.client, 'u1', 's1', {
      keepHistory: true,
      summarize: async () => {
        throw new Error('llm down')
      },
    })
    expect(r).toMatchObject({ ok: false, status: 502 })
    expect(f.tables.coach_sessions).toHaveLength(3)
    expect(f.tables.coaching_messages).toHaveLength(4)
    expect(f.tables.coach_memories ?? []).toHaveLength(0)
  })

  it('memory insert failure deletes nothing', async () => {
    const f = makeFakeSupabase({
      failOn: ['coach_memories.insert'],
      tables: { coach_sessions: [{ id: 's1', user_id: 'u1', title: 't' }], coaching_messages: [{ id: 'm1', user_id: 'u1', session_id: 's1', role: 'user', content: 'x', created_at: '2026-01-01T00:00:00Z' }] },
    })
    const r = await deleteChatSession(f.client, 'u1', 's1', { keepHistory: true, summarize: async () => 'sum' })
    expect(r).toMatchObject({ ok: false, status: 500 })
    expect(f.tables.coach_sessions).toHaveLength(1)
    expect(f.tables.coaching_messages).toHaveLength(1)
  })

  it('empty session with keep just deletes', async () => {
    const f = makeFakeSupabase({ tables: { coach_sessions: [{ id: 's1', user_id: 'u1', title: 't' }] } })
    const summarize = vi.fn()
    const r = await deleteChatSession(f.client, 'u1', 's1', { keepHistory: true, summarize })
    expect(r).toEqual({ ok: true, deleted: 's1', memory: null })
    expect(summarize).not.toHaveBeenCalled()
    expect(f.tables.coach_sessions).toHaveLength(0)
  })

  it('foreign user gets 404 and nothing changes', async () => {
    const f = seed()
    const r = await deleteChatSession(f.client, 'u2', 's1', { keepHistory: false, summarize: vi.fn() })
    expect(r).toMatchObject({ ok: false, status: 404 })
    expect(f.tables.coach_sessions).toHaveLength(3)
    expect(f.tables.coaching_messages).toHaveLength(4)
  })
})
