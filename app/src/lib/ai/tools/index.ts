import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { computeReadiness } from '../readiness'
import { computeBestSplits } from '../splits'
import { formatPace } from '@/lib/utils'
import { activityDraftSchema } from '@/lib/activities/draft-schema'
import { insertManualActivity, findLikelyDuplicate } from '@/lib/activities/insert-manual'
import {
  listStravaActivities as listStravaActivitiesSvc,
  importStravaActivities as importStravaActivitiesSvc,
} from '@/lib/integrations/strava/sync'
import { formatDistance, formatDuration } from '@/lib/utils'

/**
 * Factory — builds all typed Mastra tools with a scoped Supabase client.
 * Called per-request so RLS applies to the authenticated user.
 *
 * `admin` is an optional service-role client. It's required ONLY for the Strava
 * tools, which must decrypt the user's stored Strava tokens (service_role-only
 * pgcrypto). When omitted, the Strava tools return a clear "not available"
 * message instead of failing. All other tools use the RLS-scoped `supabase`.
 */
export function buildCoachTools(
  supabase: SupabaseClient<Database>,
  userId: string,
  admin?: SupabaseClient<Database>
) {
  // ─── getRecentActivities ──────────────────────────────────────────────────
  const getRecentActivities = createTool({
    id: 'getRecentActivities',
    description:
      'Fetch the most recent activities for the athlete. Returns key metrics for each. Use this for quick summaries like "how was my last run" or "show me recent workouts".',
    inputSchema: z.object({
      limit: z.number().min(1).max(20).default(5).describe('Number of activities to return'),
      sportType: z
        .enum(['run', 'football', 'gym', 'cycle', 'other'])
        .optional()
        .describe('Filter by sport type'),
    }),
    execute: async (inputData) => {
      let query = supabase
        .from('activities')
        .select(
          'id, sport_type, started_at, duration_s, distance_m, avg_hr_bpm, avg_pace_s_per_km, training_load, rpe, notes'
        )
        .eq('user_id', userId)
        .order('started_at', { ascending: false })
        .limit(inputData.limit)

      if (inputData.sportType) {
        query = query.eq('sport_type', inputData.sportType)
      }

      const { data, error } = await query
      if (error) throw new Error(`Failed to fetch activities: ${error.message}`)
      return { activities: data ?? [] }
    },
  })

  // ─── getTrainingLoad ──────────────────────────────────────────────────────
  const getTrainingLoad = createTool({
    id: 'getTrainingLoad',
    description:
      "Calculate the athlete's readiness: ATL (acute/fatigue), CTL (chronic/fitness), TSB (form), and a 0-100 readiness score. Use this to assess readiness before prescribing sessions. If the athlete has little history the score defaults to fresh — say so rather than claiming fatigue.",
    inputSchema: z.object({}),
    execute: async () => {
      const readiness = await computeReadiness(supabase, userId)
      if (!readiness) {
        return {
          hasData: false,
          message:
            'No activities logged yet, so training load cannot be computed. Assume the athlete is fresh.',
        }
      }
      return { hasData: true, ...readiness }
    },
  })

  // ─── getBestSplits ─────────────────────────────────────────────────────────
  const getBestSplits = createTool({
    id: 'getBestSplits',
    description:
      'Compute the athlete\'s FASTEST rolling splits (400m, 1km, 1mile, 5km, 10km) from the actual GPS/pace stream of recent runs. USE THIS for any "fastest / best pace over X distance" question. Never estimate splits from average pace — always call this tool. ' +
      'For "my most recent run" or "my last run", call with limit=1 and no other args. ' +
      'For "my run on <date>", pass date as "YYYY-MM-DD" (do NOT guess an activityId). ' +
      'Only set activityId when you have a real activity UUID from a previous tool result. ' +
      'Returns split times per run; null means the run was shorter than that distance.',
    // IMPORTANT: every field is NULLABLE with a default, NOT `.optional()`.
    // Under OpenAI function-calling strict mode (used on the AI SDK → Mastra
    // tool path), an `.optional()` field is still emitted as a REQUIRED JSON-schema
    // property, so when the model omits it the call fails validation with
    // `activityId: Required (received undefined)` → AI_InvalidToolArgumentsError
    // → the turn dies silently ("No response"). Making fields nullable-with-
    // default means they're ALWAYS present (never "missing"); the model passes
    // null when it has no value. We normalise null → sensible defaults here.
    // Also no .min/.max/.uuid refinements — we validate/clamp in execute().
    inputSchema: z.object({
      limit: z
        .number()
        .nullable()
        .default(null)
        .describe('How many recent runs to analyse (use 1 for "most recent run"); null = default 5.'),
      date: z
        .string()
        .nullable()
        .default(null)
        .describe('Target a run on this calendar day, formatted YYYY-MM-DD; null if not a date query.'),
      activityId: z
        .string()
        .nullable()
        .default(null)
        .describe('A specific activity UUID from a prior tool result; null for "most recent" or date queries.'),
    }),
    execute: async (inputData) => {
      // Normalise null/defaults here rather than in the schema (see note above).
      const rawLimit = typeof inputData.limit === 'number' ? inputData.limit : 5
      const limit = Math.min(Math.max(Math.trunc(rawLimit), 1), 20)
      // Only honour activityId when it's a real UUID; ignore null/sentinels like "latest".
      const activityId = isUuid(inputData.activityId ?? undefined) ? inputData.activityId! : undefined
      const date =
        typeof inputData.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(inputData.date)
          ? inputData.date
          : undefined
      const splits = await computeBestSplits(supabase, userId, { limit, activityId, date })
      if (!splits.length) {
        return {
          hasData: false,
          message: date
            ? `No run with usable pace/GPS data found on ${date}.`
            : 'No runs with usable pace/GPS data found.',
        }
      }
      // Format for the model: include both raw seconds and human pace so it can't misread.
      const runs = splits.map((s) => ({
        activityId: s.activityId,
        date: s.startedAt.slice(0, 10),
        distanceKm: s.distanceM ? +(s.distanceM / 1000).toFixed(2) : null,
        fastest: Object.fromEntries(
          Object.entries(s.best).map(([dist, secs]) => [
            dist,
            secs == null
              ? null
              : {
                  seconds: secs,
                  // pace over that split, as s/km, formatted
                  pace: formatPace(paceForSplit(dist, secs)),
                },
          ])
        ),
      }))
      return { hasData: true, runs }
    },
  })

  // ─── getPlannedSessions ───────────────────────────────────────────────────
  const getPlannedSessions = createTool({
    id: 'getPlannedSessions',
    description:
      "Fetch upcoming planned training sessions from the athlete's active plan. Use this to tell the athlete what's scheduled this week.",
    inputSchema: z.object({
      days: z
        .number()
        .min(1)
        .max(14)
        .default(7)
        .describe('How many days ahead to look'),
    }),
    execute: async (inputData) => {
      const today = new Date().toISOString().slice(0, 10)
      const until = new Date()
      until.setDate(until.getDate() + inputData.days)

      const { data, error } = await supabase
        .from('planned_sessions')
        .select(
          'id, scheduled_date, sport_type, session_type, description, target_distance_m, target_duration_s, target_hr_zone, status, ai_notes'
        )
        .eq('user_id', userId)
        .gte('scheduled_date', today)
        .lte('scheduled_date', until.toISOString().slice(0, 10))
        .order('scheduled_date', { ascending: true })

      if (error) throw new Error(`Failed to fetch planned sessions: ${error.message}`)
      return { sessions: data ?? [] }
    },
  })

  // ─── getUserProfile ───────────────────────────────────────────────────────
  const getUserProfile = createTool({
    id: 'getUserProfile',
    description:
      "Fetch the athlete's profile including goal, sports preferences, and training availability.",
    inputSchema: z.object({}),
    execute: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('display_name, date_of_birth, weight_kg, height_cm, sport_prefs, primary_goal, training_days')
        .eq('id', userId)
        .single()

      if (error) throw new Error(`Failed to fetch profile: ${error.message}`)
      return { profile: data }
    },
  })

  // ─── updateSessionStatus ──────────────────────────────────────────────────
  const updateSessionStatus = createTool({
    id: 'updateSessionStatus',
    description:
      "Update a planned session's status (completed, skipped, modified). Call this after the athlete confirms they completed or skipped a session. " +
      'sessionId MUST be a real session UUID from a getPlannedSessions result — never a guess or placeholder.',
    inputSchema: z.object({
      // Plain string (NOT .uuid()) + required by nature; validated in execute().
      sessionId: z.string().describe('The planned session UUID (from getPlannedSessions)'),
      status: z.enum(['completed', 'skipped', 'modified']),
      // nullable+default, NOT .optional() — an .optional() field is still emitted
      // as required under strict function-calling, so omitting `notes` would fail
      // validation and kill the turn. Model passes null when there's no note.
      notes: z.string().nullable().default(null).describe('Optional note about what happened; null if none'),
    }),
    execute: async (inputData) => {
      if (!isUuid(inputData.sessionId)) {
        return {
          success: false,
          error:
            'That is not a valid session id. Call getPlannedSessions first and use the exact "id" of the session you want to update.',
        }
      }
      const { error } = await supabase
        .from('planned_sessions')
        .update({ status: inputData.status, ai_notes: inputData.notes })
        .eq('id', inputData.sessionId)
        .eq('user_id', userId)

      if (error) return { success: false, error: `Failed to update session: ${error.message}` }
      return { success: true, sessionId: inputData.sessionId, status: inputData.status }
    },
  })

  // ─── addActivity ──────────────────────────────────────────────────────────
  const addActivity = createTool({
    id: 'addActivity',
    description:
      'Log a completed activity the athlete describes in chat (e.g. "add my run, 10k at 5:14/km, hr 139" or "gym 2x8 squat"). ' +
      'TWO-STEP CONFIRMATION: first call with confirmed=false to get a normalised draft, then read it back to the athlete in plain language and ask them to confirm. ' +
      'Only after they say yes, call again with confirmed=true to actually save. ' +
      'Never fabricate metrics that were not stated — leave them null. ' +
      'startedAt must be an ISO datetime; if the athlete did not give a clear date/time, ask them before saving rather than guessing.',
    inputSchema: z.object({
      confirmed: z
        .boolean()
        .default(false)
        .describe('false = return a draft for confirmation; true = save it'),
      sportType: z.enum(['run', 'football', 'gym', 'cycle', 'other']),
      startedAt: z.string().describe('ISO 8601 datetime the activity started'),
      durationS: z.number().int().positive().nullable().default(null),
      distanceM: z.number().positive().nullable().default(null),
      avgHrBpm: z.number().int().nullable().default(null),
      maxHrBpm: z.number().int().nullable().default(null),
      avgPaceSPerKm: z.number().int().nullable().default(null),
      rpe: z.number().min(1).max(10).nullable().default(null),
      notes: z.string().nullable().default(null),
      strength: z
        .array(
          z.object({
            exercise: z.string(),
            sets: z.number().int().nullable().default(null),
            reps: z.number().int().nullable().default(null),
            weightKg: z.number().nullable().default(null),
          })
        )
        .default([]),
    }),
    execute: async (inputData) => {
      const draftInput = {
        sportType: inputData.sportType,
        startedAt: inputData.startedAt,
        dateTimeNeedsConfirmation: false,
        durationS: inputData.durationS,
        distanceM: inputData.distanceM,
        avgHrBpm: inputData.avgHrBpm,
        maxHrBpm: inputData.maxHrBpm,
        avgPaceSPerKm: inputData.avgPaceSPerKm,
        avgCadenceRpm: null,
        caloriesKcal: null,
        rpe: inputData.rpe,
        notes: inputData.notes,
        strength: inputData.strength,
        assumptions: [],
        confidence: 'high' as const,
        transcript: '',
      }

      const parsed = activityDraftSchema.safeParse(draftInput)
      if (!parsed.success) {
        return { saved: false, error: parsed.error.issues[0]?.message ?? 'Invalid activity' }
      }
      const draft = parsed.data

      // Step 1: not confirmed → return the normalised draft for read-back only.
      if (!inputData.confirmed) {
        const dup = await findLikelyDuplicate(supabase, userId, {
          sportType: draft.sportType,
          startedAt: draft.startedAt,
        })
        return {
          saved: false,
          needsConfirmation: true,
          draft,
          possibleDuplicate: dup ?? undefined,
          message: 'Read this draft back to the athlete and ask them to confirm before saving.',
        }
      }

      // Step 2: confirmed → write via the shared insert path.
      try {
        const { id } = await insertManualActivity(supabase, userId, draft)
        return { saved: true, activityId: id }
      } catch (err) {
        return { saved: false, error: err instanceof Error ? err.message : 'Failed to save' }
      }
    },
  })

  // ─── listStravaActivities ─────────────────────────────────────────────────
  const listStravaActivities = createTool({
    id: 'listStravaActivities',
    description:
      "List the athlete's recent Strava activities, flagging which are already imported into SportAI. " +
      'Use this when the athlete asks what\'s on Strava or before importing, so you can read back exactly what will be imported. ' +
      'Requires the athlete to have connected Strava in Settings.',
    inputSchema: z.object({
      limit: z.number().min(1).max(50).default(10).describe('How many recent Strava activities to list'),
    }),
    execute: async (inputData) => {
      if (!admin) {
        return { available: false, message: 'Strava import is not available in this context.' }
      }
      try {
        const activities = await listStravaActivitiesSvc(admin, userId, { limit: inputData.limit })
        return {
          available: true,
          count: activities.length,
          activities: activities.map((a) => ({
            stravaId: a.id,
            name: a.name,
            sport: a.sportType,
            date: a.startedAt.slice(0, 10),
            distance: a.distanceM ? formatDistance(a.distanceM) : null,
            duration: a.durationS ? formatDuration(a.durationS) : null,
            alreadyImported: a.alreadyImported,
          })),
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to list Strava activities'
        if (msg === 'STRAVA_NOT_CONNECTED') {
          return { available: false, message: 'Strava is not connected. Ask the athlete to connect it in Settings.' }
        }
        return { available: false, message: msg }
      }
    },
  })

  // ─── importFromStrava ─────────────────────────────────────────────────────
  const importFromStrava = createTool({
    id: 'importFromStrava',
    description:
      'Import activities from the athlete\'s connected Strava account into SportAI. Duplicates are skipped automatically. ' +
      'TWO-STEP: first call with confirmed=false to preview which recent activities would be imported (read them back to the athlete), ' +
      'then call with confirmed=true to actually import. ' +
      'To import specific sessions, pass their stravaId values in `stravaIds` (get these from listStravaActivities). ' +
      'Otherwise set `limit` to import the most recent N new activities.',
    inputSchema: z.object({
      confirmed: z.boolean().default(false).describe('false = preview; true = actually import'),
      stravaIds: z
        .array(z.number())
        .optional()
        .describe('Specific Strava activity ids to import (from listStravaActivities)'),
      limit: z
        .number()
        .min(1)
        .max(50)
        .default(5)
        .describe('When no stravaIds given, import the most recent N activities'),
    }),
    execute: async (inputData) => {
      if (!admin) {
        return { imported: false, message: 'Strava import is not available in this context.' }
      }
      try {
        // Step 1: preview — list what would be imported (new ones only).
        if (!inputData.confirmed) {
          const activities = await listStravaActivitiesSvc(admin, userId, {
            limit: inputData.stravaIds?.length ? 50 : inputData.limit,
          })
          const candidates = inputData.stravaIds?.length
            ? activities.filter((a) => inputData.stravaIds!.includes(a.id))
            : activities.filter((a) => !a.alreadyImported).slice(0, inputData.limit)
          return {
            imported: false,
            needsConfirmation: true,
            willImport: candidates.map((a) => ({
              stravaId: a.id,
              name: a.name,
              date: a.startedAt.slice(0, 10),
              alreadyImported: a.alreadyImported,
            })),
            message:
              candidates.length === 0
                ? 'Nothing new to import — those activities are already in SportAI.'
                : 'Read these back to the athlete and confirm before importing.',
          }
        }

        // Step 2: confirmed → import (duplicates skipped by external_id).
        const result = await importStravaActivitiesSvc(admin, userId, {
          activityIds: inputData.stravaIds,
          limit: inputData.limit,
        })
        return {
          imported: true,
          created: result.imported,
          skippedDuplicates: result.skipped,
          failed: result.failed,
          rateLimited: result.rateLimited,
          message:
            `Imported ${result.imported}, skipped ${result.skipped} duplicate(s)${result.failed ? `, ${result.failed} failed` : ''}.` +
            (result.rateLimited
              ? ' Strava rate limit was reached, so some were skipped — tell the athlete to try again in a few minutes.'
              : ''),
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Strava import failed'
        if (msg === 'STRAVA_NOT_CONNECTED') {
          return { imported: false, message: 'Strava is not connected. Ask the athlete to connect it in Settings.' }
        }
        if (msg === 'STRAVA_ATHLETE_LIMIT') {
          return {
            imported: false,
            message:
              "This app has hit its Strava connected-athlete limit — the owner needs to raise it in Strava's API settings. Tell the athlete this isn't something they can fix.",
          }
        }
        if (msg === 'STRAVA_RATE_LIMITED') {
          return { imported: false, message: 'Strava rate limit reached. Ask the athlete to try again in a few minutes.' }
        }
        return { imported: false, message: msg }
      }
    },
  })

  return {
    getRecentActivities,
    getTrainingLoad,
    getBestSplits,
    getPlannedSessions,
    getUserProfile,
    updateSessionStatus,
    addActivity,
    listStravaActivities,
    importFromStrava,
  }
}

/** True when `v` is a real UUID (so we ignore model sentinels like "latest"). */
function isUuid(v: string | undefined): v is string {
  return (
    typeof v === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  )
}

/** Convert a split (distance label + elapsed seconds) to pace in s/km. */
function paceForSplit(distLabel: string, seconds: number): number {
  const meters: Record<string, number> = {
    '400m': 400,
    '1km': 1000,
    '1mile': 1609.34,
    '5km': 5000,
    '10km': 10000,
  }
  const m = meters[distLabel] ?? 1000
  return Math.round((seconds / m) * 1000)
}
