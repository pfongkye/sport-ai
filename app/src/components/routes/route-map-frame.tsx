'use client'
import dynamic from 'next/dynamic'
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { formatDistance } from '@/lib/utils'
import { RouteSummary, type RouteSummaryProps } from './route-summary'
import {
  isMapHistoryState,
  trapTabTarget,
  withMapHistoryState,
  withoutMapHistoryState,
} from './map-overlay'

// MapLibre touches window / WebGL — load client-only, no SSR.
const RouteMap = dynamic(() => import('./route-map'), {
  ssr: false,
  loading: () => <div className="h-full w-full rounded-lg bg-[var(--muted)] animate-pulse" />,
})

interface RouteMapFrameProps {
  geometry: { type: 'LineString'; coordinates: number[][] }
  bbox: [number, number, number, number]
  summary: RouteSummaryProps
}

const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])'
const TERRAIN_SHORT = { flat: 'Flatter', uphill: 'Hillier' } as const
const ICON_BUTTON =
  'flex h-11 w-11 items-center justify-center rounded-full bg-white text-slate-900 shadow-md ring-1 ring-black/10 active:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]'

/**
 * The route map card. ONE MapLibre instance: the same container is restyled
 * from inline to a fixed full-screen overlay (no remount), and RouteMap
 * resizes and refits when `fullscreen` changes.
 *
 * Back button: opening pushes a history entry marked in history.state; Back
 * (popstate) closes. The X button calls history.back() so the entry is popped
 * rather than left behind.
 */
export function RouteMapFrame({ geometry, bbox, summary }: RouteMapFrameProps) {
  const [open, setOpen] = useState(false)
  const [fitSignal, setFitSignal] = useState(0)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const wasOpenRef = useRef(false)

  // A reload on the marked entry would leave a stale marker: clear it so the
  // page shows normally and Back leaves /routes as usual.
  useEffect(() => {
    if (isMapHistoryState(window.history.state)) {
      window.history.replaceState(withoutMapHistoryState(window.history.state), '')
    }
  }, [])

  // System Back closes the overlay (and Forward onto the marked entry reopens it).
  useEffect(() => {
    const onPop = (e: PopStateEvent) => setOpen(isMapHistoryState(e.state))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const openMap = useCallback(() => {
    window.history.pushState(withMapHistoryState(window.history.state), '')
    setOpen(true)
  }, [])

  const closeMap = useCallback(() => {
    if (isMapHistoryState(window.history.state)) window.history.back() // popstate closes
    else setOpen(false)
  }, [])

  // Scroll lock; restored on close and unmount.
  useEffect(() => {
    if (!open) return
    const { style } = document.body
    const prev = { overflow: style.overflow, overscroll: style.overscrollBehavior }
    style.overflow = 'hidden'
    style.overscrollBehavior = 'none'
    return () => {
      style.overflow = prev.overflow
      style.overscrollBehavior = prev.overscroll
    }
  }, [open])

  // Focus into the dialog on open, back to the expand button on close.
  useEffect(() => {
    if (open) closeRef.current?.focus()
    else if (wasOpenRef.current) triggerRef.current?.focus()
    wasOpenRef.current = open
  }, [open])

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (!open) return
    if (e.key === 'Escape') {
      e.preventDefault()
      closeMap()
      return
    }
    if (e.key !== 'Tab' || !dialogRef.current) return
    const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (el) => el.offsetParent !== null || el === document.activeElement
    )
    const target = trapTabTarget(items.length, items.indexOf(document.activeElement as HTMLElement), e.shiftKey)
    if (target !== null) {
      e.preventDefault()
      items[target]?.focus()
    }
  }

  return (
    <div className="relative h-[320px] w-full">
      <div
        ref={dialogRef}
        {...(open
          ? { role: 'dialog', 'aria-modal': true, 'aria-label': 'Route map' }
          : {})}
        onKeyDown={onKeyDown}
        className={
          open
            ? 'map-overlay-in fixed inset-0 z-[100] h-dvh w-screen overscroll-contain bg-[var(--background)] [&_.maplibregl-ctrl-top-right]:mt-[max(env(safe-area-inset-top),0.75rem)] [&_.maplibregl-ctrl-top-right]:mr-[max(env(safe-area-inset-right),0.5rem)]'
            : 'relative h-full w-full [&_.maplibregl-ctrl-top-right]:mt-14'
        }
      >
        <RouteMap
          geometry={geometry}
          bbox={bbox}
          fullscreen={open}
          fitSignal={fitSignal}
          className={open ? 'h-full w-full' : 'h-full w-full rounded-lg overflow-hidden'}
        />

        {!open && (
          <button
            ref={triggerRef}
            type="button"
            onClick={openMap}
            aria-label="View map full screen"
            className={`${ICON_BUTTON} absolute right-2 top-2`}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
            </svg>
          </button>
        )}

        {open && (
          <>
            <div
              className="pointer-events-none absolute inset-x-0 top-0 flex items-start gap-2 pr-14"
              style={{
                paddingTop: 'max(env(safe-area-inset-top), 0.75rem)',
                paddingLeft: 'max(env(safe-area-inset-left), 0.75rem)',
              }}
            >
              <button
                ref={closeRef}
                type="button"
                onClick={closeMap}
                aria-label="Close full screen map"
                className={`${ICON_BUTTON} pointer-events-auto shrink-0`}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
              <div
                aria-hidden="true"
                className="flex min-h-11 min-w-0 items-center gap-3 rounded-full bg-white px-4 text-sm font-semibold tabular-nums text-slate-900 shadow-md ring-1 ring-black/10"
              >
                <span>{formatDistance(summary.distanceM)}</span>
                <span>↑ {Math.round(summary.ascentM)} m</span>
                <span className="truncate">{TERRAIN_SHORT[summary.terrain]}</span>
              </div>
            </div>
            {/* Full text summary for screen readers (the visible strip is a compact duplicate). */}
            <div className="sr-only">
              <RouteSummary {...summary} />
            </div>
            <button
              type="button"
              onClick={() => setFitSignal((n) => n + 1)}
              aria-label="Fit route to screen"
              className={`${ICON_BUTTON} absolute`}
              style={{
                right: 'max(env(safe-area-inset-right), 0.5rem)',
                bottom: 'calc(max(env(safe-area-inset-bottom), 0.5rem) + 2.75rem)',
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="3" />
                <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
              </svg>
            </button>
          </>
        )}
      </div>
    </div>
  )
}
