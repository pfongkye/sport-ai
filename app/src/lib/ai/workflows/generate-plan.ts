import { generateObject } from 'ai'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { resolveUserAISettings, resolveModel } from '../provider'
import { computeReadiness } from '../readiness'
import { localDateInTz } from '@/lib/plan/dates'
import { planSchema, planToRows, type PlanDraft } from './plan-schema'
import {
  buildSkeleton,
  RAMP_RATE,
  computeBaselineWeeklyKm,
  SkeletonError,
  type Skeleton,
} from './plan-skeleton'
import { repairPlan, sanitizePlan, TARGET_TOLERANCE, validatePlanDetailed } from './plan-guardrails'

/** Bounded generation time (spec Req 5.1). A multi-month plan is a large output. */
export const PLAN_TIMEOUT_MS = 90_000
const MAX_OUTPUT_TOKENS = 16_000
/** Whole-request budget (first call + one feedback retry); the route's maxDuration is above it. */
export const PLAN_TOTAL_BUDGET_MS = 170_000
/** Do not start the retry with less than this left. */
const MIN_RETRY_MS = 20_000

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
  /** Weeks the guardrails scaled down automatically; empty when the plan was used as generated. */
  adjustments: string[]
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

  const startedAt = Date.now()
  const promptArgs = {
    goal,
    today,
    skeleton,
    sportPrefs: profile?.sport_prefs ?? ['run'],
    readiness,
    recent: summariseRecent(recentActivities),
  }
  const callModel = async (feedback: string[] | null): Promise<PlanDraft> => {
    const remaining = PLAN_TOTAL_BUDGET_MS - (Date.now() - startedAt)
    try {
      const result = await generateObject({
        model,
        schema: planSchema,
        system: buildSystemPrompt(),
        prompt: buildPrompt({ ...promptArgs, feedback }),
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        abortSignal: AbortSignal.timeout(Math.min(PLAN_TIMEOUT_MS, remaining)),
      })
      return result.object
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
  }

  // ── 4. Validate, repair soft volume violations, else retry once ───────────
  const rejected = (issues: string[], soft: boolean) => {
    console.warn('[plan/generate] plan rejected by guardrails', issues)
    return new PlanGenerationError(
      'INVALID_PLAN',
      soft
        ? 'The plan was slightly outside safe limits, so nothing was saved. Try again.'
        : 'The generated plan did not meet safety checks, so nothing was saved. Try again.',
      issues
    )
  }
  const check = (draft: PlanDraft) => {
    const clean = sanitizePlan(draft)
    const { hard, soft } = validatePlanDetailed(clean, skeleton)
    if (hard.length) throw rejected([...hard, ...soft], false)
    if (!soft.length) return { ok: true as const, plan: clean, adjustments: [] as string[], notes: [] as (string | null)[] }
    const repaired = repairPlan(clean, skeleton)
    const after = validatePlanDetailed(repaired.plan, skeleton)
    if (after.hard.length || after.soft.length) {
      return { ok: false as const, issues: [...after.hard, ...after.soft] }
    }
    return { ok: true as const, plan: repaired.plan, adjustments: repaired.adjustments, notes: repaired.sessionNotes }
  }

  let outcome = check(await callModel(null))
  if (!outcome.ok) {
    console.warn('[plan/generate] repair insufficient, retrying once with feedback', outcome.issues)
    if (PLAN_TOTAL_BUDGET_MS - (Date.now() - startedAt) < MIN_RETRY_MS) throw rejected(outcome.issues, true)
    outcome = check(await callModel(outcome.issues))
    if (!outcome.ok) throw rejected(outcome.issues, true)
  }
  const clean = outcome.plan
  if (outcome.adjustments.length) console.info('[plan/generate] repaired weeks', outcome.adjustments)

  // The window is ours, not the model's.
  const plan: PlanDraft = { ...clean, startDate: skeleton.startDate, endDate: skeleton.endDate }

  // ── 5. Persist: archive old → insert plan → insert sessions ───────────────
  const archived = await persistPlan(supabase, userId, plan, goal, outcome.notes)

  return {
    planId: archived.planId,
    sessionCount: plan.sessions.length,
    title: plan.title,
    startDate: plan.startDate,
    endDate: plan.endDate,
    weeks: skeleton.totalWeeks,
    archivedPlanIds: archived.archivedPlanIds,
    adjustments: outcome.adjustments,
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
  goal: string,
  aiNotes: (string | null)[] = []
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
    .insert(planToRows(plan, userId, inserted.id, aiNotes))
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
    '- Each week has a maxRunKm in the skeleton. The SUM of that week\'s run session distances must be at or below maxRunKm. Aim for 95% of it or less; rounding up is what gets plans rejected.',
    '- maxRunKm already reflects the 10% weekly progression limit (previous week\'s total x 1.10) and the absolute weekly cap. Never exceed it, and never go above a previous week by more than 10%.',
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
  /** Concrete guardrail violations from the previous attempt (retry only). */
  feedback?: string[] | null
}): string {
  const { skeleton: sk } = args
  // Per week: the absolute cap and previous week's target x 1.10; the lower wins.
  const maxRunKm = sk.weeks.map((w, i) => {
    const abs = w.targetKm * TARGET_TOLERANCE
    const prev = sk.weeks[i - 1]
    const ramp = w.full && prev?.full ? prev.targetKm * (1 + RAMP_RATE) : Infinity
    return Math.round(Math.min(abs, ramp) * 10) / 10
  })
  const weeks = sk.weeks.map((w) => ({
    week: w.index + 1,
    phase: w.phase,
    targetRunKm: w.targetKm,
    maxRunKm: maxRunKm[w.index],
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
    'For every week, the sum of the run session distances (targetDistanceM / 1000) must not exceed that week\'s maxRunKm. Check each week\'s sum before answering.',
    ...(args.feedback?.length
      ? [
          'YOUR PREVIOUS ATTEMPT WAS REJECTED for these reasons. Fix them (reduce the volume of the listed weeks and keep every other week within its maxRunKm):',
          ...args.feedback.map((f) => `- ${f}`),
        ]
      : []),
  ].join('\n')
}
