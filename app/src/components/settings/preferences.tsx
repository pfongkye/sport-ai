'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/card'
import { http } from '@/lib/http'
import { useLocale, useT } from '@/lib/i18n/client'
import { LANGUAGE_NATIVE_NAMES, SUPPORTED_LOCALES, isLocale } from '@/lib/i18n/locales'
import { getSpeechRecognitionCtor, readVoiceEngine, writeVoiceEngine, type VoiceEngine } from '@/lib/voice/engine'

const selectClass =
  'w-full min-h-11 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]'

/** Language picker (saved to user_settings + cookie) and the per-device voice input engine. */
export function Preferences() {
  const router = useRouter()
  const t = useT()
  const locale = useLocale()
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)
  const [saving, setSaving] = useState(false)
  const [engine, setEngine] = useState<VoiceEngine>('whisper')
  const [browserSpeech, setBrowserSpeech] = useState(false)

  useEffect(() => {
    // Browser-only capability and localStorage: read after mount to avoid a hydration mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBrowserSpeech(getSpeechRecognitionCtor() !== null)
    setEngine(readVoiceEngine())
  }, [])

  async function changeLanguage(value: string) {
    if (!isLocale(value) || value === locale) return
    setSaving(true)
    setMessage(null)
    try {
      const res = await http('/api/settings/language', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: value }),
      })
      if (!res.ok) throw new Error(String(res.status))
      // Server components re-render in the new language (cookie and setting are saved).
      router.refresh()
    } catch {
      setMessage({ text: t('settings.languageError'), error: true })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="space-y-1.5">
          <label htmlFor="settings-language" className="text-sm font-medium text-[var(--foreground)]">
            {t('settings.language')}
          </label>
          <select
            id="settings-language"
            value={locale}
            disabled={saving}
            onChange={(e) => void changeLanguage(e.target.value)}
            className={selectClass}
          >
            {SUPPORTED_LOCALES.map((l) => (
              <option key={l} value={l}>
                {LANGUAGE_NATIVE_NAMES[l]}
              </option>
            ))}
          </select>
          <p className="text-xs text-[var(--muted-foreground)]">{t('settings.languageHelp')}</p>
          {message && (
            <p role={message.error ? 'alert' : 'status'} className="text-xs text-[var(--destructive)]">
              {message.text}
            </p>
          )}
        </div>

        {browserSpeech && (
          <div className="space-y-1.5">
            <label htmlFor="settings-voice-engine" className="text-sm font-medium text-[var(--foreground)]">
              {t('settings.voiceEngine')}
            </label>
            <select
              id="settings-voice-engine"
              value={engine}
              onChange={(e) => {
                const next = e.target.value === 'browser' ? 'browser' : 'whisper'
                writeVoiceEngine(next)
                setEngine(next)
              }}
              className={selectClass}
            >
              <option value="whisper">{t('settings.voiceWhisper')}</option>
              <option value="browser">{t('settings.voiceBrowser')}</option>
            </select>
            <p className="text-xs text-[var(--muted-foreground)]">{t('settings.voiceHelp')}</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
