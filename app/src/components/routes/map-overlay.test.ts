import { describe, it, expect } from 'vitest'
import {
  MAP_HISTORY_KEY,
  isMapHistoryState,
  trapTabTarget,
  withMapHistoryState,
  withoutMapHistoryState,
} from './map-overlay'

describe('map history state', () => {
  it('detects only the marker', () => {
    expect(isMapHistoryState(null)).toBe(false)
    expect(isMapHistoryState('x')).toBe(false)
    expect(isMapHistoryState({})).toBe(false)
    expect(isMapHistoryState({ [MAP_HISTORY_KEY]: true })).toBe(true)
  })
  it('adds the marker and keeps existing keys', () => {
    const s = withMapHistoryState({ __NA: true })
    expect(s).toEqual({ __NA: true, [MAP_HISTORY_KEY]: true })
    expect(withMapHistoryState(null)).toEqual({ [MAP_HISTORY_KEY]: true })
  })
  it('removes the marker and keeps other keys', () => {
    expect(withoutMapHistoryState({ __NA: true, [MAP_HISTORY_KEY]: true })).toEqual({ __NA: true })
  })
})

describe('trapTabTarget', () => {
  it('wraps forward from the last element', () => {
    expect(trapTabTarget(3, 2, false)).toBe(0)
  })
  it('wraps backward from the first element', () => {
    expect(trapTabTarget(3, 0, true)).toBe(2)
  })
  it('lets the browser move within the list', () => {
    expect(trapTabTarget(3, 1, false)).toBeNull()
    expect(trapTabTarget(3, 1, true)).toBeNull()
  })
  it('pulls focus in when it is outside the list', () => {
    expect(trapTabTarget(3, -1, false)).toBe(0)
    expect(trapTabTarget(3, -1, true)).toBe(2)
  })
  it('does nothing with no focusable elements', () => {
    expect(trapTabTarget(0, -1, false)).toBeNull()
  })
})
