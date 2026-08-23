'use client'

import { useState } from 'react'
import { useRecorder } from '@/hooks/use-recorder'
import { http } from '@/lib/http'
import { cn } from '@/lib/utils'

interface VoiceRecorderProps {
  /** Called with the transcript once recording is transcribed. */
  onTranscript: (text: string) => void
  disabled?: boolean
}

/**
 * Mic button that records, transcribes via /api/ai/voice/transcribe, and hands
 * the text back to the parent. Tap to start, tap again to stop & transcribe.
 */
export function VoiceRecorder({ onTranscript, disabled }: VoiceRecorderProps) {
  const { state, error, start, stop } = useRecorder()
  const [transcribing, setTranscribing] = useState(false)

  async function toggle() {
    if (transcribing || disabled) return

    if (state === 'recording') {
      const blob = await stop()
      if (!blob) return
      setTranscribing(true)
      try {
        const form = new FormData()
        form.append('audio', blob, 'audio.webm')
        const res = await http('/api/ai/voice/transcribe', { method: 'POST', body: form })
        const json = await res.json().catch(() => ({}))
        if (res.ok && json.text) {
          onTranscript(json.text)
        } else {
          onTranscript('') // parent can ignore empty
          console.warn('transcription:', json.error ?? res.status)
        }
      } finally {
        setTranscribing(false)
      }
    } else {
      await start()
    }
  }

  const recording = state === 'recording'

  return (
    <div className="flex flex-col items-center">
      <button
        type="button"
        onClick={toggle}
        disabled={disabled || transcribing}
        aria-label={recording ? 'Stop recording' : 'Record voice'}
        aria-pressed={recording}
        className={cn(
          'shrink-0 flex items-center justify-center size-10 rounded-xl transition-colors disabled:opacity-40',
          recording
            ? 'bg-red-500 text-white animate-pulse'
            : 'bg-[var(--muted)] text-[var(--foreground)] hover:bg-[var(--border)]'
        )}
      >
        {transcribing ? (
          <svg className="size-5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : recording ? (
          <svg viewBox="0 0 24 24" fill="currentColor" className="size-4" aria-hidden>
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-5" aria-hidden>
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
        )}
      </button>
      {error && <span className="text-[10px] text-red-500 mt-1 max-w-24 text-center">{error}</span>}
    </div>
  )
}
