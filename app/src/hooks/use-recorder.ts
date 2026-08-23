'use client'

import { useCallback, useRef, useState } from 'react'

export type RecorderState = 'idle' | 'recording' | 'error'

/**
 * Minimal MediaRecorder wrapper. Records mic audio to a Blob.
 * Handles permission errors and picks a supported mime type.
 */
export function useRecorder() {
  const [state, setState] = useState<RecorderState>('idle')
  const [error, setError] = useState<string | null>(null)
  const mediaRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const streamRef = useRef<MediaStream | null>(null)

  const start = useCallback(async () => {
    setError(null)
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setState('error')
      setError('Recording not supported in this browser')
      return false
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mime = pickMimeType()
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      chunksRef.current = []
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      rec.start()
      mediaRef.current = rec
      setState('recording')
      return true
    } catch (err) {
      setState('error')
      setError(
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'Microphone permission denied'
          : 'Could not start recording'
      )
      return false
    }
  }, [])

  /** Stop and resolve with the recorded Blob (or null if nothing captured). */
  const stop = useCallback((): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const rec = mediaRef.current
      if (!rec || rec.state === 'inactive') {
        cleanup()
        setState('idle')
        resolve(null)
        return
      }
      rec.onstop = () => {
        const type = rec.mimeType || 'audio/webm'
        const blob = chunksRef.current.length ? new Blob(chunksRef.current, { type }) : null
        cleanup()
        setState('idle')
        resolve(blob)
      }
      rec.stop()
    })
  }, [])

  const cleanup = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    mediaRef.current = null
    chunksRef.current = []
  }

  return { state, error, start, stop }
}

function pickMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c
  }
  return null
}
