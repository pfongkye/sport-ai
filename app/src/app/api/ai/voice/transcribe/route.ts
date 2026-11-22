import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveUserAISettings } from '@/lib/ai/provider'
import { transcribeAudio, WhisperError } from '@/lib/voice/whisper'

export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_AUDIO_BYTES = 25 * 1024 * 1024 // Whisper API limit

/**
 * POST /api/ai/voice/transcribe
 * Multipart form: "audio" (a recorded blob) and optional "language" (the athlete's saved
 * language, 'en' | 'fr', used only as a fallback hint).
 * Returns { text, language } where `language` is the detected (or hinted) ISO-639-1 code.
 *
 * DECISION (do not change without asking the user): `/audio/transcriptions`, never
 * `/audio/translations`. The language is auto-detected (no pinned `language`), so the
 * text stays in the language spoken. See lib/voice/whisper.ts for the retry rules.
 *
 * Whisper is OpenAI-only, so this always uses the OpenAI key (user's if set for
 * the openai provider, else the system key) regardless of the chat provider.
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form' }, { status: 400 })
  }

  const audio = form.get('audio')
  if (!(audio instanceof File)) {
    return NextResponse.json({ error: 'No audio provided' }, { status: 400 })
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: 'Audio too large (max 25MB)' }, { status: 400 })
  }
  if (audio.size < 512) {
    return NextResponse.json({ error: 'Recording too short' }, { status: 400 })
  }

  // Resolve an OpenAI key (Whisper is OpenAI-only)
  const { settings, userApiKey } = await resolveUserAISettings(user.id)
  const openaiKey =
    settings?.ai_provider === 'openai' && userApiKey ? userApiKey : process.env.OPENAI_API_KEY
  if (!openaiKey) {
    return NextResponse.json(
      { error: 'No OpenAI key available for transcription.' },
      { status: 500 }
    )
  }

  try {
    const result = await transcribeAudio({
      audio: new Blob([Buffer.from(await audio.arrayBuffer())], { type: audio.type || 'audio/webm' }),
      apiKey: openaiKey,
      hint: form.get('language') ?? settings?.language,
    })
    return NextResponse.json({ text: result.text, language: result.language })
  } catch (err) {
    if (err instanceof WhisperError) {
      return NextResponse.json({ error: err.message }, { status: 502 })
    }
    console.error('[voice/transcribe] request failed', err)
    return NextResponse.json({ error: 'Transcription request failed' }, { status: 502 })
  }
}
