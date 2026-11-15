/**
 * Pure helpers for the full-screen route map overlay. No DOM access, so they
 * are unit-testable.
 */

/** history.state key marking the entry pushed when the overlay opens. */
export const MAP_HISTORY_KEY = 'sportaiRouteMap'

function asRecord(state: unknown): Record<string, unknown> {
  return state && typeof state === 'object' ? (state as Record<string, unknown>) : {}
}

/** True when a history.state value is the entry pushed by the open overlay. */
export function isMapHistoryState(state: unknown): boolean {
  return asRecord(state)[MAP_HISTORY_KEY] === true
}

/**
 * State for pushState on open. Keeps the existing keys because Next's App
 * Router stores its own internal data in history.state.
 */
export function withMapHistoryState(state: unknown): Record<string, unknown> {
  return { ...asRecord(state), [MAP_HISTORY_KEY]: true }
}

/** State for replaceState that drops the marker (e.g. after a reload on it). */
export function withoutMapHistoryState(state: unknown): Record<string, unknown> {
  const { [MAP_HISTORY_KEY]: _marker, ...rest } = asRecord(state)
  void _marker
  return rest
}

/**
 * Index to focus on Tab / Shift+Tab inside a focus trap, or null when the
 * browser's default move stays inside the trap. `current` is the index of the
 * focused element in the focusable list, or -1 when focus is outside the list.
 */
export function trapTabTarget(count: number, current: number, shift: boolean): number | null {
  if (count <= 0) return null
  if (current < 0) return shift ? count - 1 : 0
  if (shift && current === 0) return count - 1
  if (!shift && current === count - 1) return 0
  return null
}

/** Short-and-wide screens (phone rotated). Mirrors the `short-landscape` Tailwind variant in globals.css. */
export const SHORT_LANDSCAPE_QUERY = '(orientation: landscape) and (max-height: 500px)'

export type MapOrientation = 'landscape' | 'portrait'

/** Orientation of a map container from its size (square counts as portrait). */
export function orientationOf(width: number, height: number): MapOrientation {
  return width > height ? 'landscape' : 'portrait'
}

export interface FitPadding {
  top: number
  bottom: number
  left: number
  right: number
}

const FIT_PADDING_INLINE = 40
// Portrait fullscreen: clear the top bar (close + summary strip) and bottom controls.
const FIT_PADDING_FULLSCREEN: FitPadding = { top: 96, bottom: 80, left: 32, right: 32 }
// Short landscape fullscreen: the summary is a left side panel; zoom/fit buttons sit on the right.
const FIT_PADDING_FULLSCREEN_LANDSCAPE: FitPadding = { top: 24, bottom: 24, left: 176, right: 72 }

/** Padding for fitBounds, by overlay state and screen shape. */
export function fitPaddingFor(fullscreen: boolean, shortLandscape: boolean): number | FitPadding {
  if (!fullscreen) return FIT_PADDING_INLINE
  return shortLandscape ? FIT_PADDING_FULLSCREEN_LANDSCAPE : FIT_PADDING_FULLSCREEN
}
