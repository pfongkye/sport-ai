import { describe, it, expect } from 'vitest'
import { insertNormalizedActivity } from './insert-normalized'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { NormalizedActivity } from '@/types/activity'

/**
 * Characterization tests for the shared activity write path — specifically the
 * dedup contract (duplicate / created / unique-violation-as-duplicate) that the
 * file-upload route and the Strava importer both rely on.
 */

function activity(overrides: Partial<NormalizedActivity> = {}): NormalizedActivity {
  return {
    source: 'strava',
    externalId: 'strava_1',
    sportType: 'run',
    startedAt: new Date('2026-01-01T00:00:00Z'),
    durationS: 1800,
    distanceM: 5000,
    streams: [],
    rawData: {},
    ...overrides,
  }
}

/**
 * Stub Supabase. `existing` controls the dedup lookup result; `insertResult`
 * controls the insert outcome. Records whether streams were inserted.
 */
function makeSupabase(opts: {
  existing?: { id: string } | null
  insertResult?: { data: { id: string } | null; error: { code?: string; message?: string } | null }
}) {
  const streamInserts: unknown[] = []
  const client = {
    from(table: string) {
      if (table === 'activities') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: opts.existing ?? null }),
              }),
            }),
          }),
          insert: () => ({
            select: () => ({
              single: async () =>
                opts.insertResult ?? { data: { id: 'new-id' }, error: null },
            }),
          }),
        }
      }
      // activity_streams
      return {
        insert: async (rows: unknown) => {
          streamInserts.push(rows)
          return { error: null }
        },
      }
    },
    storage: { from: () => ({ upload: async () => ({ error: null }) }) },
  }
  return { client: client as unknown as SupabaseClient<Database>, streamInserts }
}

describe('insertNormalizedActivity', () => {
  it('skips as duplicate when an activity with the same external_id exists', async () => {
    const { client } = makeSupabase({ existing: { id: 'existing-1' } })
    const res = await insertNormalizedActivity(client, 'user-1', activity())
    expect(res.status).toBe('duplicate')
    expect(res.activityId).toBe('existing-1')
  })

  it('inserts and reports created when no duplicate exists', async () => {
    const { client } = makeSupabase({ existing: null, insertResult: { data: { id: 'new-99' }, error: null } })
    const res = await insertNormalizedActivity(client, 'user-1', activity())
    expect(res.status).toBe('created')
    expect(res.activityId).toBe('new-99')
  })

  it('treats a unique-violation (23505) race as a duplicate, not an error', async () => {
    const { client } = makeSupabase({
      existing: null,
      insertResult: { data: null, error: { code: '23505', message: 'duplicate key' } },
    })
    const res = await insertNormalizedActivity(client, 'user-1', activity())
    expect(res.status).toBe('duplicate')
  })

  it('reports an error for a non-dedup insert failure', async () => {
    const { client } = makeSupabase({
      existing: null,
      insertResult: { data: null, error: { code: '23502', message: 'not null violation' } },
    })
    const res = await insertNormalizedActivity(client, 'user-1', activity())
    expect(res.status).toBe('error')
    expect(res.message).toMatch(/not null/i)
  })

  it('errors when the activity has no external_id (cannot dedup)', async () => {
    const { client } = makeSupabase({ existing: null })
    const res = await insertNormalizedActivity(client, 'user-1', activity({ externalId: undefined }))
    expect(res.status).toBe('error')
  })

  it('inserts stream rows when the activity has streams', async () => {
    const { client, streamInserts } = makeSupabase({
      existing: null,
      insertResult: { data: { id: 'new-1' }, error: null },
    })
    await insertNormalizedActivity(
      client,
      'user-1',
      activity({ streams: [{ type: 'heartrate', data: [{ t: 0, v: 140 }] }] })
    )
    expect(streamInserts).toHaveLength(1)
  })
})
