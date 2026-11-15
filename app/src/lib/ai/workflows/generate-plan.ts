import { generateObject } from 'ai'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { resolveUserAISettings, resolveModel } from '../provider'
import { computeReadiness } from '../readiness'
import { localDateInTz } from '@/lib/plan/dates'
import { planSchema, planToRows, type PlanDraft } from './plan-schema'
import {
  buildSkeleton,
  computeBaselineWeeklyKm,
  SkeletonError,
  type Skeleton,
} from './plan-skeleton'
import { sanitizePlan, validatePlan } from './plan-guardrails'

/** Bounded generation time (spec Req 5.1). A multi-month plan is a large output. */
export const PLAN_TIMEOUT_MS = 90_000
const MAX_OUTPUT_TOKENS = 16_000

export type PlanErrorCode =
  | 'GOAL_DATE_INVALID'
  | 'GOAL_TOO_SOON'
  | 'AI_NOT_CONFIGURED'
  | 'TIMEOUT'
  | 'GENERATION_FAILED'
  | 'INVALID_PLAN'
  | 'PERSIST_FAILED'

export class PlanGenerationError extends Error {
  constructor(
    public code: PlanErrorCode,
    message: string,
    public issues: string[] = []
  ) {
    super(message)
    this.name = 'PlanGenerationError'
  }
}

export interface GeneratePlanOptions {
  /** Free-text goal; defaults to the profile's primary_goal. */
  goal?: string | null
  /** YYYY-MM-DD; null/undefined = a default 12-week block with no taper. */
  goalDate?: string | null
  /** Injectable clock for tests. */
  now?: Date
}

export interface GeneratePlanResult {
  planId: string
  sessionCount: number
  title: string
  startDate: string
  endDate: string
  weeks: number
  /** Ids of plans archived by this generation. */
  archivedPlanIds: string[]
}

/**
 * Deterministic workflow with ONE structured LLM call:
 * context → skeleton → generateObject → sanitize + guardrails → persist.
 * Shared by POST /api/plan/generate and the `generatePlan` chat tool.
 * Nothing is written unless the whole plan passes validation (Req 5.1/5.2).
 */
export async function generateTrainingPlan(
  supabase: SupabaseClient<Database>,
  userId: string,
  opts: GeneratePlanOptions = {}
): Promise<GeneratePlanResult> {
  const now = opts.now ?? new Date()

  // ── 1. Context (deterministic) ────────────────────────────────────────────
  const { settings, userApiKey } = await resolveUserAISettings(userId)
  const today = localDateInTz(now, settings?.timezone)

  const { data: profile } = await supabase
    .from('profiles')
    .select('primary_goal, training_days, sport_prefs')
    .eq('id', userId)
    .maybeSingle()

  const since = new Date(now.getTime() - 28 * 86400000).toISOString()
  const { data: recent } = await supabase
    .from('activities')
    .select('sport_type, started_at, distance_m, duration_s')
    .eq('user_id', userId)
    .gte('started_at', since)
  const recentActivities = recent ?? []
  const readiness = await computeReadiness(supabase, userId)

  // ── 2. Skeleton (deterministic) ───────────────────────────────────────────
  let skeleton: Skeleton
  try {
    skeleton = buildSkeleton({
      today,
      goalDate: opts.goalDate ?? null,
      trainingDays: profile?.training_days,
      baselineWeeklyKm: computeBaselineWeeklyKm(recentActivities, now),
    })
  } catch (err) {
    if (err instanceof SkeletonError) throw new PlanGenerationError(err.code, err.message)
    throw err
  }

  const goal = (opts.goal?.trim() || profile?.primary_goal?.trim() || 'General fitness').slice(0, 300)

  // ── 3. One structured LLM call ────────────────────────────────────────────
  let model
  try {
    model = resolveModel(
      settings?.ai_provider ?? 'openai',
      settings?.ai_model ?? 'gpt-4o',
      userApiKey
    )
  } catch {
    throw new PlanGenerationError('AI_NOT_CONFIGURED', 'AI is not configured.')
  }

  let draft: PlanDraft
  try {
    const result = await generateObject({
      model,
      schema: planSchema,
      system: buildSystemPrompt(),
      prompt: buildPrompt({
        goal,
        today,
        skeleton,
        sportPrefs: profile?.sport_prefs ?? ['run'],
        readiness,
        recent: summariseRecent(recentActivities),
      }),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      abortSignal: AbortSignal.timeout(PLAN_TIMEOUT_MS),
    })
    draft = result.object
  } catch (err) {
    console.error('[plan/generate] generateObject failed', err)
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
    throw new PlanGenerationError(
      timedOut ? 'TIMEOUT' : 'GENERATION_FAILED',
      timedOut
        ? 'Plan generation took too long. Try again.'
        : 'The AI could not produce a plan. Try again.'
    )
  }

  // ── 4. Validate + guardrails (nothing written on failure) ─────────────────
  const clean = sanitizePlan(draft)
  const issues = validatePlan(clean, skeleton)
  if (issues.length) {
    console.warn('[plan/generate] plan rejected by guardrails', issues)
    throw new PlanGenerationError(
      'INVALID_PLAN',
      'The generated plan did not meet safety checks, so nothing was saved. Try again.',
      issues
    )
  }
  // The window is ours, not the model's.
  const plan: PlanDraft = { ...clean, startDate: skeleton.startDate, endDate: skeleton.endDate }

  // ── 5. Persist: archive old → insert plan → insert sessions ───────────────
  const archived = await persistPlan(supabase, userId, plan, goal)

  return {
    planId: archived.planId,
    sessionCount: plan.sessions.length,
    title: plan.title,
    startDate: plan.startDate,
    endDate: plan.endDate,
    weeks: skeleton.totalWeeks,
    archivedPlanIds: archived.archivedPlanIds,
  }
}

/**
 * Archive the active plan(s), insert the new plan, then its sessions. If the
 * session insert fails the new plan row is deleted and the previously active
 * plans are reactivated, so a failure never leaves an empty plan or loses the
 * athlete's current one. (No multi-statement transaction over the JS client.)
 */
export async function persistPlan(
  supabase: SupabaseClient<Database>,
  userId: string,
  plan: PlanDraft,
  goal: string
): Promise<{ planId: string; archivedPlanIds: string[] }> {
  const { data: active, error: activeErr } = await supabase
    .from('training_plans')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'active')
  if (activeErr) throw new PlanGenerationError('PERSIST_FAILED', 'Could not save the plan.')
  const archivedPlanIds = (active ?? []).map((p) => p.id)

  if (archivedPlanIds.length) {
    const { error } = await supabase
      .from('training_plans')
      .update({ status: 'archived' })
      .eq('user_id', userId)
      .in('id', archivedPlanIds)
    if (error) throw new PlanGenerationError('PERSIST_FAILED', 'Could not archive the previous plan.')
  }

  const restoreArchived = async () => {
    if (!archivedPlanIds.length) return
    await supabase
      .from('training_plans')
      .update({ status: 'active' })
      .eq('user_id', userId)
      .in('id', archivedPlanIds)
  }

  const { data: inserted, error: planErr } = await supabase
    .from('training_plans')
    .insert({
      user_id: userId,
      title: plan.title.trim() || 'Training plan',
      goal: plan.goal.trim() || goal,
      start_date: plan.startDate,
      end_date: plan.endDate,
      status: 'active',
    })
    .select('id')
    .single()
  if (planErr || !inserted) {
    await restoreArchived()
    throw new PlanGenerationError('PERSIST_FAILED', 'Could not save the plan.')
  }

  const { error: sessionsErr } = await supabase
    .from('planned_sessions')
    .insert(planToRows(plan, userId, inserted.id))
  if (sessionsErr) {
    console.error('[plan/generate] session insert failed, cleaning up', sessionsErr)
    await supabase.from('training_plans').delete().eq('id', inserted.id).eq('user_id', userId)
    await restoreArchived()
    throw new PlanGenerationError('PERSIST_FAILED', 'Could not save the plan sessions.')
  }

  return { planId: inserted.id, archivedPlanIds }
}

// ── Prompt construction ─────────────────────────────────────────────────────

function summariseRecent(
  acts: { sport_type: string; started_at: string; distance_m: number | null; duration_s: number | null }[]
): string {
  if (!acts.length) return 'No activities logged in the last 4 weeks.'
  const bySport = new Map<string, { n: number; km: number; h: number }>()
  for (const a of acts) {
    const e = bySport.get(a.sport_type) ?? { n: 0, km: 0, h: 0 }
    e.n += 1
    e.km += (a.distance_m ?? 0) / 1000
    e.h += (a.duration_s ?? 0) / 3600
    bySport.set(a.sport_type, e)
  }
  return [...bySport.entries()]
    .map(([s, e]) => `${s}: ${e.n} sessions, ${e.km.toFixed(1)} km, ${e.h.toFixed(1)} h`)
    .join('; ')
}

export function buildSystemPrompt(): string {
  return [
    'You are an expert endurance coach writing a structured training plan as data.',
    'You are given a fixed skeleton: weeks, the exact dates that are training slots, each week\'s phase and its weekly run-volume target in km. Fill it in.',
    'HARD RULES (a plan that breaks any of them is discarded):',
    '- Schedule sessions ONLY on the listed slot dates. Never on any other date. At most 2 sessions on one date.',
    '- Do NOT output rest-day rows. A date without a session is a rest day.',
    '- Weekly total of run distance must be at or below the week\'s target km, and never more than ~10% above the previous week.',
    '- Every base/build/peak week with 3+ slots needs exactly one session whose sessionType is "long run" (use the week\'s long-run km).',
    '- Distances are in METRES (targetDistanceM), durations in SECONDS (targetDurationS), HR zone is an integer 1-5 or null.',
    'PERIODIZATION: progressive overload through base and build, a lighter recovery week as marked, a taper (reduced volume, keep a little intensity) before the goal date. Most running is easy (zone 2); add tempo or intervals once or twice a week in build/peak phases only.',
    'Use other sports (gym, cycle, football) only if they are in the athlete\'s sport preferences, and keep them short and supportive.',
    'If the athlete has little history or readiness is low, keep intensity conservative. Do not invent medical advice.',
    'Output title and goal as short plain text. Set startDate and endDate to the window given.',
  ].join('\n')
}

export function buildPrompt(args: {
  goal: string
  today: string
  skeleton: Skeleton
  sportPrefs: string[]
  readiness: { score: number; label: string; ctl: number; atl: number; tsb: number; message: string } | null
  recent: string
}): string {
  const { skeleton: sk } = args
  const weeks = sk.weeks.map((w) => ({
    week: w.index + 1,
    phase: w.phase,
    targetRunKm: w.targetKm,
    longRunKm: w.longRunKm,
    slotDates: w.slotDates,
  }))
  return [
    `Goal: ${args.goal}`,
    `Today: ${args.today}`,
    `Plan window: ${sk.startDate} to ${sk.endDate}${sk.hasGoalDate ? ' (the end date is the goal/race date)' : ' (no goal date; general block)'}`,
    `Sport preferences: ${args.sportPrefs.join(', ')}`,
    `Readiness: ${
      args.readiness
        ? `${args.readiness.score}/100 ${args.readiness.label} (CTL ${args.readiness.ctl}, ATL ${args.readiness.atl}, TSB ${args.readiness.tsb}). ${args.readiness.message}`
        : 'no history, treat as fresh'
    }`,
    `Recent 4 weeks: ${args.recent}`,
    `Weekly skeleton (JSON):`,
    JSON.stringify(weeks),
  ].join('\n')
}
