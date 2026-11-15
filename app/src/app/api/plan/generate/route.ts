import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateTrainingPlan, PlanGenerationError } from '@/lib/ai/workflows/generate-plan'

export const runtime = 'nodejs'
// One structured LLM call for a multi-week plan; keep a bounded ceiling above PLAN_TIMEOUT_MS.
export const maxDuration = 120

const STATUS_BY_CODE: Record<PlanGenerationError['code'], number> = {
  GOAL_DATE_INVALID: 400,
  GOAL_TOO_SOON: 400,
  AI_NOT_CONFIGURED: 503,
  TIMEOUT: 504,
  GENERATION_FAILED: 502,
  INVALID_PLAN: 422,
  PERSIST_FAILED: 500,
}

/**
 * POST /api/plan/generate
 * Body: { goal?: string, goalDate?: 'YYYY-MM-DD' }
 * Generates a plan with the same workflow the chat tool uses and archives the
 * previous active plan. Returns { planId, sessionCount, ... }.
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { goal?: unknown; goalDate?: unknown } = {}
  try {
    const text = await request.text()
    if (text.trim()) body = JSON.parse(text) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const goal = typeof body.goal === 'string' && body.goal.trim() ? body.goal.trim() : null
  const goalDate =
    typeof body.goalDate === 'string' && body.goalDate.trim() ? body.goalDate.trim() : null

  try {
    const result = await generateTrainingPlan(supabase, user.id, { goal, goalDate })
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    if (err instanceof PlanGenerationError) {
      return NextResponse.json(
        { error: err.message, code: err.code, issues: err.issues },
        { status: STATUS_BY_CODE[err.code] ?? 500 }
      )
    }
    console.error('[plan/generate] unexpected failure', err)
    return NextResponse.json({ error: 'Failed to generate plan' }, { status: 500 })
  }
}
