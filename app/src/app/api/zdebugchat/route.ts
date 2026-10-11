// TEMPORARY debug route — reproduces the coach chat path (no auth) and reports
// exactly where the stream goes empty. DELETE after diagnosis. Guarded by a
// query token so it isn't openly callable.
import { createAdminClient } from '@/lib/supabase/server'
import { buildCoachAgent } from '@/lib/ai/agents/coach'
import { resolveUserAISettings } from '@/lib/ai/provider'
import { computeReadiness } from '@/lib/ai/readiness'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(request: Request) {
  const url = new URL(request.url)
  if (url.searchParams.get('token') !== 'splitprobe-9f3a') {
    return new Response('nope', { status: 404 })
  }
  const userId = url.searchParams.get('user') ?? ''
  const log: string[] = []
  try {
    const admin = await createAdminClient()
    if (!userId) {
      // list candidate users with run streams so we can pick one
      const { data } = await admin
        .from('activities')
        .select('user_id')
        .eq('sport_type', 'run')
        .limit(1)
      return Response.json({ hint: 'pass ?user=<id>', sampleUser: data?.[0]?.user_id ?? null })
    }

    const [{ data: profile }, aiSettings, readiness] = await Promise.all([
      admin.from('profiles').select('*').eq('id', userId).single().then((r) => ({ data: r.data })),
      resolveUserAISettings(userId),
      computeReadiness(admin, userId),
    ])
    log.push(`provider=${aiSettings.settings?.ai_provider} model=${aiSettings.settings?.ai_model} userKey=${aiSettings.userApiKey ? 'y' : 'n'} sysKey=${process.env.OPENAI_API_KEY ? 'y' : 'n'}`)

    const agent = await buildCoachAgent({
      supabase: admin,
      userId,
      profile: profile ?? null,
      settings: aiSettings.settings,
      readiness,
      userApiKey: aiSettings.userApiKey,
      admin,
    })

    const messages = [{ role: 'user' as const, content: 'What is my fastest 1km segment on my most recent run?' }]

    // Try stream() and streamLegacy() independently so we see which one works.
    for (const method of ['stream', 'streamLegacy'] as const) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res: any = await (agent as any)[method](messages)
        let text = ''
        let chunks = 0
        for await (const c of res.textStream) {
          text += c
          chunks++
        }
        log.push(`${method}: OK chunks=${chunks} len=${text.length} preview=${JSON.stringify(text.slice(0, 120))}`)
      } catch (e) {
        log.push(`${method}: THREW ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`)
      }
    }

    return Response.json({ ok: true, log })
  } catch (e) {
    log.push('OUTER ' + (e instanceof Error ? e.stack || e.message : String(e)))
    return Response.json({ ok: false, log })
  }
}
