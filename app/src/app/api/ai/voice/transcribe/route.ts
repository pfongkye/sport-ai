import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveUserAISettings } from '@/lib/ai/provider'

export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_AUDIO_BYTES = 25 * 1024 * 1024 // Whisper API limit

/**
 * POST /api/ai/voice/transcribe
 * Multipart form with field "audio" (a recorded blob).
 * Returns { text } — transcribed in the SPOKEN language (no translation).
 *
 * DECISION (do not change without asking the user): use `/audio/transcriptions`
 * with an explicit `language` hint. We deliberately do NOT use
 * `/audio/translations` (which force-outputs English) — the user chose
 * transcription so the text stays in the language spoken. Whisper's
 * auto-detection can misfire on short/accented clips (e.g. English mis-detected
 * as French), so we pin the expected language. English-only for now → `language=en`.
 *
 * When i18n lands: source the hint from the user's language preference
 * (user_settings.language) instead of the hardcoded default below.
 *
 * Whisper is OpenAI-only, so this always uses the OpenAI key (user's if set for
 * the openai provider, else the system key) regardless of the chat provider.
 */
const TRANSCRIBE_LANGUAGE = 'en' // ISO-639-1; TODO(i18n): use user_settings.language
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

  // Forward to OpenAI Whisper. Re-wrap the blob so the multipart filename/type
  // are set correctly for the API.
  const buffer = Buffer.from(await audio.arrayBuffer())
  const oaForm = new FormData()
  oaForm.append('file', new Blob([buffer], { type: audio.type || 'audio/webm' }), 'audio.webm')
  oaForm.append('model', 'whisper-1')
  oaForm.append('response_format', 'json')
  // Pin the language so Whisper doesn't mis-detect (e.g. English → French) on
  // short/accented clips. This is a spoken-language HINT — text stays in the
  // language spoken. Do NOT switch to /audio/translations (see file header).
  oaForm.append('language', TRANSCRIBE_LANGUAGE)

  let text = ''
  try {
    // Transcription (NOT translation) — preserves the spoken language.
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openaiKey}` },
      body: oaForm,
    })
    if (!res.ok) {
      const errBody = await res.text()
      console.error('[voice/transcribe] whisper error', res.status, errBody.slice(0, 300))
      return NextResponse.json(
        { error: `Transcription failed (${res.status})` },
        { status: 502 }
      )
    }
    const json = (await res.json()) as { text?: string }
    text = (json.text ?? '').trim()
  } catch (err) {
    console.error('[voice/transcribe] request failed', err)
    return NextResponse.json({ error: 'Transcription request failed' }, { status: 502 })
  }

  return NextResponse.json({ text })
}
