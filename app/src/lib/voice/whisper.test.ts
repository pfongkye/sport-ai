import { describe, it, expect, vi } from 'vitest'
import { normalizeDetectedLanguage, transcribeAudio, WhisperError } from './whisper'

const audio = new Blob([new Uint8Array(1024)], { type: 'audio/webm' })

function reply(json: object, ok = true, status = 200) {
  return { ok, status, json: async () => json, text: async () => JSON.stringify(json) } as unknown as Response
}
const sentField = (fetchMock: ReturnType<typeof vi.fn>, call: number, name: string) =>
  (fetchMock.mock.calls[call][1].body as FormData).get(name)

describe('transcribeAudio', () => {
  it('sends no language, asks for verbose_json and returns the detected language', async () => {
    const f = vi.fn().mockResolvedValue(
      reply({ text: ' Bonjour, je suis allé courir ce matin. ', language: 'french', duration: 6 })
    )
    const out = await transcribeAudio({ audio, apiKey: 'k', hint: 'en', fetchImpl: f as never })
    expect(out).toEqual({ text: 'Bonjour, je suis allé courir ce matin.', language: 'fr', usedHint: false })
    expect(f).toHaveBeenCalledTimes(1)
    expect(f.mock.calls[0][0]).toBe('https://api.openai.com/v1/audio/transcriptions')
    expect(sentField(f, 0, 'language')).toBeNull()
    expect(sentField(f, 0, 'response_format')).toBe('verbose_json')
  })

  it('never calls the translations endpoint', async () => {
    const f = vi.fn().mockResolvedValue(reply({ text: 'a b c d', language: 'english', duration: 5 }))
    await transcribeAudio({ audio, apiKey: 'k', hint: 'fr', fetchImpl: f as never })
    for (const c of f.mock.calls) expect(String(c[0])).not.toContain('translations')
  })

  it('keeps a short clip detected as the other supported language', async () => {
    const f = vi.fn().mockResolvedValue(reply({ text: 'Oui', language: 'french', duration: 1 }))
    const out = await transcribeAudio({ audio, apiKey: 'k', hint: 'en', fetchImpl: f as never })
    expect(f).toHaveBeenCalledTimes(1)
    expect(out).toEqual({ text: 'Oui', language: 'fr', usedHint: false })
  })

  it('retries once with the hint when the first result is empty', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(reply({ text: '', language: 'english', duration: 1 }))
      .mockResolvedValueOnce(reply({ text: 'Merci', language: 'french', duration: 1 }))
    const out = await transcribeAudio({ audio, apiKey: 'k', hint: 'fr', fetchImpl: f as never })
    expect(f).toHaveBeenCalledTimes(2)
    expect(out).toEqual({ text: 'Merci', language: 'fr', usedHint: true })
  })

  it('retries once with the hint for an unsupported language on a short clip', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(reply({ text: 'Merci', language: 'spanish', duration: 1 }))
      .mockResolvedValueOnce(reply({ text: 'Merci', language: 'french', duration: 1 }))
    const out = await transcribeAudio({ audio, apiKey: 'k', hint: 'fr', fetchImpl: f as never })
    expect(f).toHaveBeenCalledTimes(2)
    expect(sentField(f, 1, 'language')).toBe('fr')
    expect(out).toEqual({ text: 'Merci', language: 'fr', usedHint: true })
  })

  it('retries with the hint when an unsupported language is detected', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(reply({ text: 'ola que tal estas hoy', language: 'portuguese', duration: 5 }))
      .mockResolvedValueOnce(reply({ text: 'allez on y va aujourd hui', language: 'french', duration: 5 }))
    const out = await transcribeAudio({ audio, apiKey: 'k', hint: 'fr', fetchImpl: f as never })
    expect(out.language).toBe('fr')
    expect(out.text).toContain('allez')
  })

  it('does not retry without a valid hint or for a long clear clip', async () => {
    const short = vi.fn().mockResolvedValue(reply({ text: 'ok', language: 'english', duration: 1 }))
    await transcribeAudio({ audio, apiKey: 'k', hint: 'de', fetchImpl: short as never })
    expect(short).toHaveBeenCalledTimes(1)
    const long = vi.fn().mockResolvedValue(reply({ text: 'one two three four', language: 'english', duration: 8 }))
    await transcribeAudio({ audio, apiKey: 'k', hint: 'fr', fetchImpl: long as never })
    expect(long).toHaveBeenCalledTimes(1)
  })

  it('throws WhisperError on an API failure', async () => {
    const f = vi.fn().mockResolvedValue(reply({ error: 'x' }, false, 500))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(transcribeAudio({ audio, apiKey: 'k', fetchImpl: f as never })).rejects.toBeInstanceOf(WhisperError)
  })

  it('normalizes language names', () => {
    expect(normalizeDetectedLanguage('English')).toBe('en')
    expect(normalizeDetectedLanguage('french')).toBe('fr')
    expect(normalizeDetectedLanguage('')).toBeNull()
    expect(normalizeDetectedLanguage(3)).toBeNull()
  })
})
