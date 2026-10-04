import { createClient, createAdminClient } from '@/lib/supabase/server'
import { buildCoachAgent, streamAgentText } from '@/lib/ai/agents/coach'
import { resolveUserAISettings } from '@/lib/ai/provider'
import { formatDistance, formatDuration, formatPace, SPORT_LABELS } from '@/lib/utils'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * GET /api/activities/[id]/insight
 * Returns the stored post-session insight for this activity if present.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })

  const { data } = await supabase
    .from('coaching_messages')
    .select('content, created_at')
    .eq('user_id', user.id)
    .eq('role', 'assistant')
    .contains('metadata', { activity_id: id })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return new Response(JSON.stringify({ insight: data?.content ?? null }), {
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * POST /api/activities/[id]/insight
 * Generates (or regenerates) a coaching insight for this activity, streams it,
 * and stores it linked via metadata.activity_id.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })

  const { data: activity } = await supabase
    .from('activities')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (!activity) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 })

  const [{ data: profile }, aiSettings] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).single().then((r) => ({ data: r.data })),
    resolveUserAISettings(user.id),
  ])

  let agent
  try {
    agent = await buildCoachAgent({
      supabase,
      userId: user.id,
      profile: profile ?? null,
      settings: aiSettings.settings,
      readiness: null,
      userApiKey: aiSettings.userApiKey,
    })
  } catch {
    return new Response(
      JSON.stringify({ error: 'AI is not configured. Add an API key in Settings.' }),
      { status: 500 }
    )
  }

  const summary = summarizeActivity(activity)

  // Include the athlete's own notes so the analysis reflects subjective feel,
  // not just the device numbers.
  const { data: notes } = await supabase
    .from('activity_notes')
    .select('transcript')
    .eq('user_id', user.id)
    .eq('activity_id', id)
    .order('created_at', { ascending: true })
  const notesBlock = notes?.length
    ? `\n\nThe athlete's own notes on this session:\n${notes.map((n) => `- ${n.transcript}`).join('\n')}`
    : ''

  const prompt = `Give a short post-session analysis of this ${SPORT_LABELS[activity.sport_type] ?? activity.sport_type}:

${summary}${notesBlock}

In 3-4 sentences: assess the effort (pacing/HR), note one thing that went well, and one concrete thing to focus on next time.${notesBlock ? ' Take the athlete\'s notes into account.' : ''} Be specific and encouraging. No preamble.`

  let result
  try {
    result = await streamAgentText(agent, [{ role: 'user', content: prompt }])
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'AI request failed' }),
      { status: 502 }
    )
  }

  const encoder = new TextEncoder()
  let full = ''
  const admin = await createAdminClient()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of result.textStream) {
          full += chunk
          controller.enqueue(encoder.encode(chunk))
        }
      } finally {
        controller.close()
        if (full.trim()) {
          // Remove any prior insight for this activity, then store the new one.
          await admin
            .from('coaching_messages')
            .delete()
            .eq('user_id', user.id)
            .eq('role', 'assistant')
            .contains('metadata', { activity_id: id })
          await admin.from('coaching_messages').insert({
            user_id: user.id,
            role: 'assistant',
            content: full,
            metadata: { activity_id: id, kind: 'post_session_insight' },
          })
        }
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function summarizeActivity(a: any): string {
  const parts: string[] = []
  if (a.distance_m) parts.push(`Distance: ${formatDistance(a.distance_m)}`)
  if (a.duration_s) parts.push(`Duration: ${formatDuration(a.duration_s)}`)
  if (a.avg_pace_s_per_km) parts.push(`Avg pace: ${formatPace(a.avg_pace_s_per_km)}`)
  if (a.avg_hr_bpm) parts.push(`Avg HR: ${a.avg_hr_bpm} bpm`)
  if (a.max_hr_bpm) parts.push(`Max HR: ${a.max_hr_bpm} bpm`)
  if (a.avg_cadence_rpm) parts.push(`Avg cadence: ${a.avg_cadence_rpm} spm`)
  if (a.elevation_gain_m) parts.push(`Elevation gain: ${Math.round(a.elevation_gain_m)} m`)
  if (a.calories_kcal) parts.push(`Calories: ${a.calories_kcal} kcal`)
  if (a.training_load) parts.push(`Training load: ${Math.round(a.training_load)}`)
  return parts.join('\n')
}
