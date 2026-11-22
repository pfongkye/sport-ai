import { isLocale, type Locale } from '@/lib/i18n/locales'

/**
 * Whisper transcription with language auto-detection.
 *
 * DECISION: `/audio/transcriptions` only, NEVER `/audio/translations` (that one force-outputs
 * English). With no `language` parameter Whisper detects the spoken language and writes the
 * transcript in it, so a French sentence stays French. The old route pinned `language=en`,
 * which makes Whisper write English-looking text for French speech (the likely cause of the
 * "voice is translated to English" report; not verified against a live recording).
 *
 * The athlete's saved language is a FALLBACK hint: used for one retry only when detection
 * failed (empty text) or returned a language the app does not support. A short clip that was
 * detected as en or fr is kept as is, so a French "oui" from an English-setting user is not
 * re-run as English.
 */
export const WHISPER_URL = 'https://api.openai.com/v1/audio/transcriptions'

const NAME_TO_CODE: Record<string, string> = { english: 'en', french: 'fr' }

/** Whisper reports the language as an English name ("french"); return an ISO-639-1 code when known. */
export function normalizeDetectedLanguage(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  const v = raw.trim().toLowerCase()
  return NAME_TO_CODE[v] ?? (v.length === 2 ? v : v)
}

interface WhisperJson {
  text?: string
  language?: string
  duration?: number
}

export interface WhisperAttempt {
  text: string
  language: string | null
  duration: number | null
}

export class WhisperError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message)
  }
}

async function callWhisper(
  audio: Blob,
  apiKey: string,
  language: Locale | null,
  fetchImpl: typeof fetch
): Promise<WhisperAttempt> {
  const form = new FormData()
  form.append('file', audio, 'audio.webm')
  form.append('model', 'whisper-1')
  form.append('response_format', 'verbose_json')
  if (language) form.append('language', language)
  const res = await fetchImpl(WHISPER_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  })
  if (!res.ok) {
    const errBody = await res.text()
    console.error('[voice/transcribe] whisper error', res.status, errBody.slice(0, 300))
    throw new WhisperError(res.status, `Transcription failed (${res.status})`)
  }
  const json = (await res.json()) as WhisperJson
  return {
    text: (json.text ?? '').trim(),
    language: language ?? normalizeDetectedLanguage(json.language),
    duration: typeof json.duration === 'number' ? json.duration : null,
  }
}

/** True when detection failed (empty text) or found a language the app does not support. */
export function needsHintRetry(first: WhisperAttempt): boolean {
  return !first.text || !isLocale(first.language)
}

export async function transcribeAudio(params: {
  audio: Blob
  apiKey: string
  /** The athlete's saved language; fallback hint only. */
  hint?: unknown
  fetchImpl?: typeof fetch
}): Promise<{ text: string; language: string | null; usedHint: boolean }> {
  const fetchImpl = params.fetchImpl ?? fetch
  const hint = isLocale(params.hint) ? params.hint : null
  const first = await callWhisper(params.audio, params.apiKey, null, fetchImpl)
  if (hint && needsHintRetry(first)) {
    const second = await callWhisper(params.audio, params.apiKey, hint, fetchImpl)
    // Keep the hinted text unless it came back empty.
    if (second.text) return { text: second.text, language: hint, usedHint: true }
  }
  return { text: first.text, language: first.language, usedHint: false }
}
