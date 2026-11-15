#!/usr/bin/env node
/**
 * Backfill ascent_m / descent_m on suggested_routes rows saved before the ascent
 * fix (AGENTS.md #41). Recomputes from the stored geometry z values using the
 * same smoothElevation + computeElevationGain path as suggest.ts. Rows whose
 * geometry has no z are skipped.
 *
 * DRY RUN by default. Pass --apply to write.
 *
 *   cd app
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node --experimental-strip-types scripts/backfill-route-ascent.mjs [--apply] [--batch=200]
 *
 * Needs Node 22.6+ (imports geo.ts directly). Uses the service role key: run it
 * from a trusted machine only, never in the browser or CI logs.
 */
import { createClient } from '@supabase/supabase-js'
import { recomputeAscent } from '../src/lib/integrations/ors/geo.ts'

const apply = process.argv.includes('--apply')
const batchArg = process.argv.find((a) => a.startsWith('--batch='))
const batchSize = Math.max(1, Number(batchArg?.split('=')[1]) || 200)

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.')
  process.exit(1)
}

const supabase = createClient(url, key, { auth: { persistSession: false } })

let lastId = null
let scanned = 0
let changed = 0
let skipped = 0
let failed = 0

console.log(apply ? 'APPLY mode: rows will be updated.' : 'DRY RUN: no rows will be written (use --apply).')

for (;;) {
  let q = supabase
    .from('suggested_routes')
    .select('id, ascent_m, descent_m, geometry')
    .order('id', { ascending: true })
    .limit(batchSize)
  if (lastId) q = q.gt('id', lastId)
  const { data, error } = await q
  if (error) {
    console.error('Query failed:', error.message)
    process.exit(1)
  }
  if (!data || data.length === 0) break

  for (const row of data) {
    scanned++
    lastId = row.id
    const coords = row.geometry?.coordinates
    const next = Array.isArray(coords) ? recomputeAscent(coords) : null
    if (!next) {
      skipped++
      continue
    }
    if (next.ascentM === row.ascent_m && next.descentM === row.descent_m) continue
    changed++
    console.log(`${row.id}: ascent ${row.ascent_m} -> ${next.ascentM}, descent ${row.descent_m} -> ${next.descentM}`)
    if (apply) {
      const { error: upErr } = await supabase
        .from('suggested_routes')
        .update({ ascent_m: next.ascentM, descent_m: next.descentM })
        .eq('id', row.id)
      if (upErr) {
        failed++
        console.error(`  update failed for ${row.id}: ${upErr.message}`)
      }
    }
  }
}

console.log(
  `Done. scanned=${scanned} ${apply ? 'updated' : 'would-update'}=${changed - failed} skipped(no z)=${skipped} failed=${failed}`
)
process.exit(failed > 0 ? 1 : 0)
