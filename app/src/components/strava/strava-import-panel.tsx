'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { http } from '@/lib/http'
import { SPORT_EMOJI, formatDistance, formatDuration } from '@/lib/utils'

interface StravaActivityItem {
  id: number
  name: string
  sportType: string
  startedAt: string
  distanceM: number
  durationS: number
  alreadyImported: boolean
}

/**
 * Lists recent Strava activities with checkboxes and imports the selected ones.
 * Already-imported activities are shown but disabled (duplicates are skipped
 * server-side regardless). Used in Settings and on the Activities page.
 *
 * Assumes Strava is connected — the parent only renders this when connected.
 */
export function StravaImportPanel({ onImported }: { onImported?: (created: number) => void }) {
  const [items, setItems] = useState<StravaActivityItem[] | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notConnected, setNotConnected] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  // Core fetch. Returns a promise; callers (effect, Refresh button) attach the
  // state updates in a `.then` so we never setState synchronously in the effect.
  const fetchActivities = useCallback(async () => {
    const res = await http('/api/integrations/strava/activities?limit=30')
    const body = await res.json().catch(() => ({}))
    if (res.status === 409) return { notConnected: true as const }
    if (!res.ok) throw new Error(body.error ?? 'Failed to load Strava activities')
    return { notConnected: false as const, list: (body.activities ?? []) as StravaActivityItem[] }
  }, [])

  const applyResult = useCallback(
    (r: { notConnected: boolean; list?: StravaActivityItem[] }) => {
      if (r.notConnected) {
        setNotConnected(true)
        setItems(null)
        return
      }
      setNotConnected(false)
      const list = r.list ?? []
      setItems(list)
      // Pre-select everything not yet imported.
      setSelected(new Set(list.filter((a) => !a.alreadyImported).map((a) => a.id)))
    },
    []
  )

  // Refresh handler (runs in an event/explicit call — sync setState is fine here).
  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setNotConnected(false)
    setResult(null)
    try {
      applyResult(await fetchActivities())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load Strava activities')
    } finally {
      setLoading(false)
    }
  }, [fetchActivities, applyResult])

  // Initial load — fetch first, then apply state in the async continuation so no
  // setState runs synchronously in the effect body.
  useEffect(() => {
    let active = true
    fetchActivities()
      .then((r) => {
        if (active) applyResult(r)
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : 'Failed to load Strava activities')
      })
    return () => {
      active = false
    }
  }, [fetchActivities, applyResult])

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function doImport() {
    const ids = [...selected]
    if (!ids.length) return
    setImporting(true)
    setError(null)
    setResult(null)
    try {
      const res = await http('/api/integrations/strava/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activityIds: ids }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'Import failed')
      setResult(
        `Imported ${body.imported}, skipped ${body.skipped} duplicate(s)` +
          (body.failed ? `, ${body.failed} failed.` : '.')
      )
      onImported?.(body.imported ?? 0)
      await load() // refresh flags (imported ones now disabled)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  const newCount = items?.filter((a) => !a.alreadyImported).length ?? 0

  if (notConnected) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-[var(--muted-foreground)]">
          Strava isn&rsquo;t connected yet. Connect it to import your activities.
        </p>
        <Button asChild>
          <a href="/settings#integrations">Connect Strava in Settings</a>
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-[var(--muted-foreground)]">
          {loading
            ? 'Loading your Strava activities…'
            : items
              ? `${items.length} recent · ${newCount} new`
              : ''}
        </p>
        <Button variant="outline" size="sm" onClick={load} disabled={loading || importing}>
          Refresh
        </Button>
      </div>

      {error && (
        <div role="alert" className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-md px-3 py-2">
          {error}
        </div>
      )}
      {result && (
        <div role="status" className="text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-md px-3 py-2">
          {result}
        </div>
      )}

      {items && items.length > 0 && (
        <ul className="divide-y divide-[var(--border)] rounded-md border border-[var(--border)] max-h-80 overflow-y-auto">
          {items.map((a) => (
            <li key={a.id}>
              <label
                className={
                  'flex items-center gap-3 px-3 py-2.5 text-sm ' +
                  (a.alreadyImported
                    ? 'opacity-55 cursor-default'
                    : 'cursor-pointer hover:bg-[var(--muted)]/40')
                }
              >
                <input
                  type="checkbox"
                  className="size-4 shrink-0 accent-[var(--primary)]"
                  checked={a.alreadyImported || selected.has(a.id)}
                  disabled={a.alreadyImported || importing}
                  onChange={() => toggle(a.id)}
                  aria-label={`Select ${a.name}`}
                />
                <span className="text-lg shrink-0" aria-hidden>
                  {SPORT_EMOJI[a.sportType.toLowerCase()] ?? '🏅'}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block truncate font-medium">{a.name}</span>
                  <span className="block text-xs text-[var(--muted-foreground)]">
                    {a.startedAt.slice(0, 10)}
                    {a.distanceM ? ` · ${formatDistance(a.distanceM)}` : ''}
                    {a.durationS ? ` · ${formatDuration(a.durationS)}` : ''}
                  </span>
                </span>
                {a.alreadyImported && (
                  <span className="shrink-0 text-xs text-[var(--muted-foreground)]">Imported</span>
                )}
              </label>
            </li>
          ))}
        </ul>
      )}

      {items && items.length === 0 && !loading && (
        <p className="text-sm text-[var(--muted-foreground)]">No recent activities on Strava.</p>
      )}

      <div className="flex items-center gap-2">
        <Button onClick={doImport} disabled={importing || loading || selected.size === 0}>
          {importing ? 'Importing…' : `Import ${selected.size || ''} selected`.trim()}
        </Button>
      </div>
    </div>
  )
}
