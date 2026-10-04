'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { http } from '@/lib/http'
import { StravaImportPanel } from './strava-import-panel'

const StravaMark = (
  <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
    <path
      fill="#FC4C02"
      d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169"
    />
  </svg>
)

interface StravaConnection {
  athlete_firstname: string | null
  athlete_lastname: string | null
  athlete_username: string | null
  last_synced_at: string | null
}

/** Map the ?strava= callback status to a one-time banner message. */
function statusBanner(status?: string): string | null {
  if (!status) return null
  const messages: Record<string, string> = {
    connected: 'Strava connected. Pick activities to import below.',
    denied: 'Strava connection was cancelled.',
    invalid_state: 'Strava connection failed a security check. Please try again.',
    athlete_limit:
      "This app has reached its Strava connected-athlete limit. The owner needs to raise the athlete cap in the Strava API settings dashboard before more accounts can connect.",
    error: 'Something went wrong connecting Strava. Please try again.',
  }
  return messages[status] ?? null
}

/**
 * Settings → Integrations → Strava.
 * Shows connect/disconnect and, when connected, the import picker.
 *
 * `initialConnection` is read server-side; `initialStatus` comes from the
 * ?strava= query param set by the OAuth callback so we can surface a one-time
 * banner (connected / denied / error).
 */
export function StravaSettings({
  initialConnection,
  initialStatus,
}: {
  initialConnection: StravaConnection | null
  initialStatus?: string
}) {
  // Derive the one-time banner from the ?strava= status at first render — no
  // effect-driven setState needed (the value is known up front).
  const [connection, setConnection] = useState<StravaConnection | null>(initialConnection)
  const [disconnecting, setDisconnecting] = useState(false)
  const [banner, setBanner] = useState<string | null>(() => statusBanner(initialStatus))

  // Side-effect only (no setState): strip the ?strava= param from the URL so a
  // refresh doesn't re-show the banner.
  useEffect(() => {
    if (!initialStatus) return
    const url = new URL(window.location.href)
    url.searchParams.delete('strava')
    window.history.replaceState({}, '', url.toString())
  }, [initialStatus])

  async function disconnect() {
    setDisconnecting(true)
    try {
      const res = await http('/api/integrations/strava/disconnect', { method: 'POST' })
      if (res.ok) {
        setConnection(null)
        setBanner('Strava disconnected. Your imported activities were kept.')
      }
    } finally {
      setDisconnecting(false)
    }
  }

  const athleteName = connection
    ? [connection.athlete_firstname, connection.athlete_lastname].filter(Boolean).join(' ') ||
      connection.athlete_username ||
      'your Strava account'
    : null

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          {StravaMark}
          <CardTitle>Strava</CardTitle>
        </div>
        <CardDescription>
          Import your activities from Strava. Duplicates are skipped automatically. You can also
          just ask the coach — &ldquo;import my last 3 Strava runs&rdquo;.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {banner && (
          <div
            role="status"
            className="text-sm text-[var(--foreground)] bg-[var(--muted)] border border-[var(--border)] rounded-md px-3 py-2"
          >
            {banner}
          </div>
        )}

        {connection ? (
          <>
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm">
                Connected as <span className="font-medium">{athleteName}</span>
                {connection.last_synced_at && (
                  <span className="text-[var(--muted-foreground)]">
                    {' '}
                    · last synced {connection.last_synced_at.slice(0, 10)}
                  </span>
                )}
              </p>
              <Button variant="outline" size="sm" onClick={disconnect} disabled={disconnecting}>
                {disconnecting ? 'Disconnecting…' : 'Disconnect'}
              </Button>
            </div>
            <StravaImportPanel />
          </>
        ) : (
          <Button asChild>
            <a href="/api/integrations/strava/connect">Connect Strava</a>
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
