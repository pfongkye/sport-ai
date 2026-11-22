/**
 * Voice input engine choice (client only, stored in localStorage on this device).
 *  - 'whisper' (default): record, then server transcription with language auto-detect.
 *  - 'browser': Web Speech API (SpeechRecognition). Opt-in, only offered when the browser has it.
 * Web Speech cannot auto-detect: it is told the athlete's saved language up front.
 */
export type VoiceEngine = 'whisper' | 'browser'
export const VOICE_ENGINE_KEY = 'voice:engine'

// Minimal typing: lib.dom does not ship SpeechRecognition.
export interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}
export type SpeechRecognitionCtor = new () => SpeechRecognitionLike

export function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function readVoiceEngine(): VoiceEngine {
  if (typeof window === 'undefined') return 'whisper'
  try {
    const v = window.localStorage.getItem(VOICE_ENGINE_KEY)
    return v === 'browser' && getSpeechRecognitionCtor() ? 'browser' : 'whisper'
  } catch {
    return 'whisper'
  }
}

export function writeVoiceEngine(engine: VoiceEngine) {
  try {
    window.localStorage.setItem(VOICE_ENGINE_KEY, engine)
  } catch {
    // storage unavailable: keep the default
  }
}
