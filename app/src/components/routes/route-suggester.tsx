'use client'

import dynamic from 'next/dynamic'
import { useState } from 'react'
import { http } from '@/lib/http'
import { fromGeolocation } from '@/lib/integrations/ors/geo'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { ElevationProfile } from './elevation-profile'
import { RouteSummary } from './route-summary'

// MapLibre touches window / WebGL — load client-only, no SSR.
const RouteMap = dynamic(() => import('./route-map'), {
  ssr: false,
  loading: () => (
    <div className="h-[320px] w-full rounded-lg bg-[var(--muted)] animate-pulse" />
  ),
})

/** RouteResult shape returned by POST /api/routes/suggest (lng-first). */
interface RouteResult {
  routeId: string
  requestedDistanceM: number
  distanceM: number
  ascentM: number
  descentM: number
  terrain: 'flat' | 'uphill'
  bbox: [number, number, number, number]
  geometry: { type: 'LineString'; coordinates: number[][] }
  elevationProfile: { distM: number; eleM: number }[]
  start: { lng: number; lat: number; label: string | null }
}

type Terrain = 'flat' | 'uphill'
type LocationSource = 'home' | 'current' | 'place'

interface SuggestBody {
  distanceKm: number
  terrain: Terrain
  browserCoord?: { lng: number; lat: number }
  placeText?: string
}

export function RouteSuggester({ hasHome }: { hasHome: boolean }) {
  const [distanceKm, setDistanceKm] = useState(8)
  const [terrain, setTerrain] = useState<Terrain>('flat')
  const [source, setSource] = useState<LocationSource>(hasHome ? 'home' : 'current')
  const [placeText, setPlaceText] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [route, setRoute] = useState<RouteResult | null>(null)

  /** Promisified navigator.geolocation; converts to lng-first at the boundary. */
  function getBrowserCoord(): Promise<{ lng: number; lat: number }> {
    return new Promise((resolve, reject) => {
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        reject(new Error('Location is not available on this device.'))
        return
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const [lng, lat] = fromGeolocation(pos)
          resolve({ lng, lat })
        },
        () => reject(new Error('Location permission denied. Pick home or type a place instead.')),
        { enableHighAccuracy: true, timeout: 10000 }
      )
    })
  }

  async function handleSuggest() {
    setError(null)
    setLoading(true)
    try {
      const body: SuggestBody = {
        distanceKm,
        terrain,
      }
      if (source === 'current') {
        body.browserCoord = await getBrowserCoord()
      } else if (source === 'place') {
        const text = placeText.trim()
        if (!text) {
          setError('Type a place to start from.')
          setLoading(false)
          return
        }
        body.placeText = text
      }
      // source === 'home' sends nothing extra; server resolves from profile.

      const res = await http('/api/routes/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error ?? 'Could not suggest a route. Try a different distance or start.')
        return
      }
      setRoute(data.route as RouteResult)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="pt-6 space-y-5">
          {/* Distance */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="route-distance">Distance</Label>
              <span className="text-sm font-semibold tabular-nums">{distanceKm} km</span>
            </div>
            <input
              id="route-distance"
              type="range"
              min={1}
              max={42}
              step={1}
              value={distanceKm}
              onChange={(e) => setDistanceKm(Number(e.target.value))}
              className="w-full accent-[var(--primary)] h-6"
              aria-valuetext={`${distanceKm} kilometers`}
            />
          </div>

          {/* Terrain — segmented control */}
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium leading-none">Terrain</legend>
            <div
              className="grid grid-cols-2 gap-2"
              role="radiogroup"
              aria-label="Terrain preference"
            >
              {(['flat', 'uphill'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={terrain === t}
                  onClick={() => setTerrain(t)}
                  className={cn(
                    'h-11 rounded-md border text-sm font-medium transition-colors',
                    terrain === t
                      ? 'border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)]'
                      : 'border-[var(--border)] text-[var(--muted-foreground)]'
                  )}
                >
                  {t === 'flat' ? 'Flatter' : 'Hillier'}
                </button>
              ))}
            </div>
          </fieldset>

          {/* Location source — segmented control */}
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium leading-none">Start from</legend>
            <div
              className="grid grid-cols-3 gap-2"
              role="radiogroup"
              aria-label="Start location source"
            >
              {([
                { id: 'current' as const, label: 'My location' },
                { id: 'home' as const, label: 'Home' },
                { id: 'place' as const, label: 'A place' },
              ]).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  role="radio"
                  aria-checked={source === opt.id}
                  disabled={opt.id === 'home' && !hasHome}
                  onClick={() => setSource(opt.id)}
                  className={cn(
                    'h-11 rounded-md border text-sm font-medium transition-colors disabled:opacity-40',
                    source === opt.id
                      ? 'border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)]'
                      : 'border-[var(--border)] text-[var(--muted-foreground)]'
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {source === 'home' && !hasHome && (
              <p className="text-xs text-[var(--muted-foreground)]">
                Set a home location in Settings to use this.
              </p>
            )}
            {source === 'place' && (
              <div className="space-y-1.5 pt-1">
                <Label htmlFor="route-place" className="sr-only">
                  Place to start from
                </Label>
                <Input
                  id="route-place"
                  placeholder="e.g. Hyde Park, London"
                  value={placeText}
                  onChange={(e) => setPlaceText(e.target.value)}
                  autoComplete="off"
                />
              </div>
            )}
          </fieldset>

          <Button className="w-full h-11" onClick={handleSuggest} disabled={loading}>
            {loading ? 'Finding a route…' : 'Suggest a route'}
          </Button>

          {error && (
            <p role="alert" className="text-sm text-[var(--destructive)]">
              {error}
            </p>
          )}
        </CardContent>
      </Card>

      {route && (
        <Card>
          <CardContent className="pt-6 space-y-4">
            <RouteSummary
              requestedDistanceM={route.requestedDistanceM}
              distanceM={route.distanceM}
              ascentM={route.ascentM}
              descentM={route.descentM}
              terrain={route.terrain}
              startLabel={route.start.label}
            />
            <RouteMap geometry={route.geometry} bbox={route.bbox} />
            <ElevationProfile profile={route.elevationProfile} />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
