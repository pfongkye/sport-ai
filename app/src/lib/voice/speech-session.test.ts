import { describe, it, expect, vi } from 'vitest'
import { SpeechSession } from './speech-session'

describe('SpeechSession', () => {
  it('resolves the transcript when stop is requested', async () => {
    const onEnd = vi.fn()
    const s = new SpeechSession(onEnd)
    s.addFinal('bonjour')
    s.addFinal('monde')
    const p = s.stop(() => s.handleEnd())
    expect(await p).toBe('bonjour monde')
    expect(onEnd).not.toHaveBeenCalled()
  })

  it('hands the text over when the browser ends the session on its own', async () => {
    const onEnd = vi.fn()
    const s = new SpeechSession(onEnd)
    s.addFinal('ajoute une course')
    s.handleEnd()
    expect(onEnd).toHaveBeenCalledWith('ajoute une course')
    expect(await s.stop(() => {})).toBe('ajoute une course')
  })
})
