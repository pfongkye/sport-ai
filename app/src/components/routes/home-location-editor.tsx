'use client'

import { useState } from 'react'
import { http } from '@/lib/http'
import { fromGeolocation } from '@/lib/integrations/ors/geo'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface HomeLocation {
  home_lat: number | null
  home_lng: number | null
  home_label: string | null
}

/**
 * Settings → Location → Home. Lets the athlete set a home location used as the
 * default route start. Two input paths, both touch-friendly and keyboard
 * operable (no hover-only controls, gotcha #23): "Use my location" via
 * navigator.geolocation (converted lng-first at the boundary) or typing a label.
 * Saves via PATCH /api/profile/home-location through http() (gotcha #18).
 */
export function HomeLocationEditor({ initial }: { initial: HomeLocation }) {
  const [lat, setLat] = useState<number | null>(initial.home_lat)
  const [lng, setLng] = useState<number | null>(initial.home_lng)
  const [label, setLabel] = useState(initial.home_label ?? '')
  const [saving, setSaving] = useState(false)
  const [locating, setLocating] = useState(false)
  const [banner, setBanner] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const hasCoord = typeof lat === 'number' && typeof lng === 'number'

  function useMyLocation() {
    setError(null)
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setError('Location is not available on this device.')
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const [lngV, latV] = fromGeolocation(pos)
        setLat(latV)
        setLng(lngV)
        setLocating(false)
        setBanner(null)
      },
      () => {
        setError('Location permission denied. You can still type a place label and save.')
        setLocating(false)
      },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  async function save(clear = false) {
    setError(null)
    setBanner(null)
    setSaving(true)
    try {
      const body = clear
        ? { home_lat: null, home_lng: null, home_label: null }
        : { home_lat: lat, home_lng: lng, home_label: label.trim() || null }
      const res = await http('/api/profile/home-location', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error ?? 'Could not save your home location.')
        return
      }
      setLat(data.home_lat ?? null)
      setLng(data.home_lng ?? null)
      setLabel(data.home_label ?? '')
      setBanner(clear ? 'Home location cleared.' : 'Home location saved.')
    } catch {
      setError('Something went wrong saving your home location.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Home location</CardTitle>
        <CardDescription>
          Used as the default start when you ask for a route. Set it from your current location
          or type a place label.
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

        <div className="space-y-2">
          <Button
            variant="outline"
            className="w-full h-11"
            onClick={useMyLocation}
            disabled={locating}
          >
            {locating ? 'Getting location…' : 'Use my current location'}
          </Button>
          {hasCoord && (
            <p className="text-xs text-[var(--muted-foreground)]">
              Coordinates set ({lat!.toFixed(4)}, {lng!.toFixed(4)}).
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="home-label">Label (optional)</Label>
          <Input
            id="home-label"
            placeholder="e.g. Home, Office"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={120}
            autoComplete="off"
          />
        </div>

        {error && (
          <p role="alert" className="text-sm text-[var(--destructive)]">
            {error}
          </p>
        )}

        <div className="flex flex-col sm:flex-row gap-2">
          <Button
            className="flex-1 h-11"
            onClick={() => save(false)}
            disabled={saving || !hasCoord}
          >
            {saving ? 'Saving…' : 'Save home location'}
          </Button>
          {(initial.home_lat !== null || hasCoord) && (
            <Button
              variant="outline"
              className="h-11"
              onClick={() => save(true)}
              disabled={saving}
            >
              Clear
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
