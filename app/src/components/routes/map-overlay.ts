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
