'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { SpeechSession } from '@/lib/voice/speech-session'
import { getSpeechRecognitionCtor, type SpeechRecognitionLike } from '@/lib/voice/engine'

export type SpeechState = 'idle' | 'listening'

/**
 * Web Speech API wrapper. `start(lang)` begins listening in the given BCP 47 language
 * (the API cannot auto-detect); `stop()` resolves with the final transcript.
 * Chrome and Edge send the audio to a cloud service, Firefox has no support.
 */
export function useSpeechRecognition(onUnpromptedEnd?: (text: string) => void) {
  const [state, setState] = useState<SpeechState>('idle')
  const [error, setError] = useState<string | null>(null)
  const recRef = useRef<SpeechRecognitionLike | null>(null)
  const sessionRef = useRef<SpeechSession | null>(null)
  const endCbRef = useRef(onUnpromptedEnd)
  useEffect(() => {
    endCbRef.current = onUnpromptedEnd
  })

  const start = useCallback((lang: string, messages: { unsupported: string; denied: string; failed: string }) => {
    setError(null)
    const Ctor = getSpeechRecognitionCtor()
    if (!Ctor) {
      setError(messages.unsupported)
      return false
    }
    const rec = new Ctor()
    rec.lang = lang
    rec.continuous = true
    rec.interimResults = false
    const session = new SpeechSession((text) => endCbRef.current?.(text))
    sessionRef.current = session
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) session.addFinal(e.results[i][0].transcript)
      }
    }
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') setError(messages.denied)
      else if (e.error !== 'no-speech' && e.error !== 'aborted') setError(messages.failed)
    }
    rec.onend = () => {
      setState('idle')
      recRef.current = null
      session.handleEnd()
    }
    try {
      rec.start()
    } catch {
      setError(messages.failed)
      return false
    }
    recRef.current = rec
    setState('listening')
    return true
  }, [])

  const stop = useCallback((): Promise<string> => {
    return new Promise((resolve) => {
      const rec = recRef.current
      const session = sessionRef.current
      if (!rec || !session) {
        resolve('')
        return
      }
      session.stop(() => rec.stop()).then(resolve)
    })
  }, [])

  return { state, error, start, stop }
}
