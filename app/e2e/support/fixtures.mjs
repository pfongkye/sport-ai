// Deterministic fixtures served by the stub Supabase server (e2e/support/stub-supabase.mjs).
// Keep these static (fixed dates, no Date.now()) so screenshots are reproducible.

export const USER = {
  id: '00000000-0000-4000-8000-000000000001',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'e2e@example.com',
  app_metadata: { provider: 'google', providers: ['google'] },
  user_metadata: { full_name: 'E2E Athlete' },
  created_at: '2025-01-01T00:00:00Z',
}

const act = (n, sport, day, extra = {}) => ({
  id: `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`,
  user_id: USER.id,
  sport_type: sport,
  source: 'strava',
  started_at: `2025-06-${String(day).padStart(2, '0')}T06:30:00Z`,
  duration_s: 3000 + n * 240,
  distance_m: 8000 + n * 1300,
  elevation_gain_m: 40 + n * 12,
  avg_hr_bpm: 148 + n,
  avg_pace_s_per_km: 330 + n * 3,
  avg_cadence_rpm: 168,
  training_load: 55 + n * 4,
  notes: n === 2 ? 'A very long note to make sure long free text wraps instead of pushing the layout wider than the viewport on small phones.' : null,
  ...extra,
})

export const ACTIVITIES = [
  act(1, 'run', 20),
  act(2, 'run', 18, { title: 'Extra long activity title that should truncate or wrap without causing horizontal scroll' }),
  act(3, 'cycle', 15),
  act(4, 'swim', 12),
  act(5, 'run', 9),
  act(6, 'cycle', 5),
]

export const PROFILE = {
  id: USER.id,
  display_name: 'Alex',
  primary_goal: 'Run a sub-4h marathon',
  sport_prefs: ['run', 'cycle'],
  home_lat: 44.8378,
  home_lng: -0.5792,
  home_label: 'Bordeaux, France',
}

// table name -> rows. Missing tables return [].
export const TABLES = {
  profiles: [PROFILE],
  activities: ACTIVITIES,
  strava_connections: [],
  activity_streams: [],
}

// Browser-side /api/* responses (used by page.route in e2e/support/mock-api.ts).
export const SUGGESTED_ROUTE = {
  id: 'route-1',
  distanceM: 10120,
  ascentM: 42,
  descentM: 41,
  geometry: {
    type: 'LineString',
    coordinates: [[-0.5792, 44.8378], [-0.57, 44.84], [-0.565, 44.835], [-0.575, 44.83], [-0.5792, 44.8378]],
  },
}
