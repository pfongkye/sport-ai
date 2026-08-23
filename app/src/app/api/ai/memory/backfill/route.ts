import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveUserAISettings } from '@/lib/ai/provider'
import { embedForStorage } from '@/lib/ai/memory'

export const runtime = 'nodejs'
export const maxDuration = 300

/**
 * POST /api/ai/memory/backfill
 * Embeds all of the current user's coaching_messages that lack an embedding.
 * One-off maintenance route so pre-RAG history becomes searchable. Idempotent —
 * only touches rows where embedding IS NULL. Processes in small batches.
 */
export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { userApiKey } = await resolveUserAISettings(user.id)
  const admin = await createAdminClient()

  const { data: rows, error } = await admin
    .from('coaching_messages')
    .select('id, content')
    .eq('user_id', user.id)
    .is('embedding', null)
    .limit(500)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!rows?.length) return NextResponse.json({ embedded: 0, remaining: 0 })

  let embedded = 0
  let failed = 0
  for (const row of rows) {
    const vec = await embedForStorage(row.content, userApiKey)
    if (!vec) {
      failed++
      continue
    }
    const { error: upErr } = await admin
      .from('coaching_messages')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({ embedding: vec as any })
      .eq('id', row.id)
      .eq('user_id', user.id)
    if (upErr) failed++
    else embedded++
  }

  // Any left after this batch?
  const { count } = await admin
    .from('coaching_messages')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .is('embedding', null)

  return NextResponse.json({ embedded, failed, remaining: count ?? 0 })
}
