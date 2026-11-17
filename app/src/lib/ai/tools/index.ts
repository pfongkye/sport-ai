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
import { ORS_LOOP_TOO_FAR } from '@/lib/integrations/ors/client'
import { generateTrainingPlan, PlanGenerationError } from '@/lib/ai/workflows/generate-plan'
import { adjustUpcomingSessions as adjustUpcomingSessionsSvc } from '@/lib/plan/adjust'
import { getAthleteToday } from '@/lib/plan/session-guard'
import { addDays, isIsoDate, weekdayIndex, WEEKDAY_NAMES } from '@/lib/plan/dates'
import { parseConstraints, hasConstraints } from '@/lib/plan/constraints'
import { baselineReducedNote, formatRaceKm, formatTargetTime, RACE_DISTANCES, resolveLimits } from '@/lib/plan/race-goal'
import { suggestRoute as suggestRouteSvc, NO_LOCATION, type Terrain } from '@/lib/integrations/ors/suggest'

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
  admin?: SupabaseClient<Database>,
  /** Browser zone for this request (chat `tz` cookie); wins over the stored setting when valid. */
  timeZone?: string | null
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
      const today = await getAthleteToday(supabase, userId, new Date(), timeZone)
      const until = addDays(today, inputData.days)

      const { data, error } = await supabase
        .from('planned_sessions')
        .select(
          'id, scheduled_date, sport_type, session_type, description, target_distance_m, target_duration_s, target_hr_zone, status, ai_notes'
        )
        .eq('user_id', userId)
        .gte('scheduled_date', today)
        .lte('scheduled_date', until)
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
        const { id } = await insertManualActivity(supabase, userId, draft, timeZone)
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

  // ─── suggestRoute ───────────────────────────────────────────────────────
  const suggestRoute = createTool({
    id: 'suggestRoute',
    description:
      'Suggest a round-trip running route of roughly a given distance near the athlete, biased flat or uphill. ' +
      'Use this when the athlete asks for a route/loop to run (e.g. "give me a flat 8k near home", "a hilly 10k around the park"). ' +
      'Resolves the start automatically: a named place if given, else the athlete\'s saved home, else their last run\'s start. ' +
      'Returns the actual vs requested distance, ascent, terrain and start label — read these back honestly. ' +
      'If it returns needsLocation=true, ask the athlete where they want to run (a place name or to set their home in Settings).',
    // gotcha #36: every model-facing optional field is .nullable().default(null),
    // NEVER bare .optional() (strict function-calling still emits it as required,
    // so omitting it fails validation and silently kills the turn). No
    // .min/.max/.uuid — we clamp/validate inside execute(). z.enum is fine.
    inputSchema: z.object({
      distanceKm: z
        .number()
        .nullable()
        .default(null)
        .describe('Target round-trip distance in km; null = default ~8km. Clamped to 1..60.'),
      terrain: z
        .enum(['flat', 'uphill'])
        .nullable()
        .default(null)
        .describe('Terrain preference; null = flat.'),
      place: z
        .string()
        .nullable()
        .default(null)
        .describe('A named place to start from (geocoded); null uses the saved home or last run start.'),
    }),
    execute: async (inputData) => {
      // Normalise null/defaults here (see schema note). Clamp distance 1..60.
      const rawKm = typeof inputData.distanceKm === 'number' ? inputData.distanceKm : 8
      const distanceKm = Math.min(Math.max(rawKm, 1), 60)
      const terrain: Terrain = inputData.terrain === 'uphill' ? 'uphill' : 'flat'
      const place =
        typeof inputData.place === 'string' && inputData.place.trim() ? inputData.place.trim() : null

      try {
        // No browserCoord in chat — resolution falls back to place → home → last run.
        const route = await suggestRouteSvc(supabase, userId, {
          distanceKm,
          terrain,
          placeText: place,
        })
        return {
          distance: formatDistance(route.distanceM),
          requestedDistance: formatDistance(route.requestedDistanceM),
          terrain: route.terrain,
          ascent: `${route.ascentM} m`,
          startLabel: route.start.label ?? 'your start point',
          distanceWithinTolerance: route.distanceWithinTolerance !== false,
          ...(route.distanceWithinTolerance === false
            ? {
                toleranceNote:
                  'No loop landed within 10% of the requested distance. Say plainly that this is the closest loop found and give both distances.',
              }
            : {}),
          note:
            'Describe the distance, ascent and terrain honestly, including how the actual distance ' +
            'compares to what was requested. Do NOT invent named streets or landmarks.',
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (msg === NO_LOCATION) {
          return {
            needsLocation: true,
            message: 'Ask the athlete where they want to run.',
          }
        }
        if (msg === ORS_LOOP_TOO_FAR) {
          return {
            error:
              "Couldn't find a loop of about the requested distance from there (the area may be an island or have limited paths). Tell the athlete to try a different start point or distance.",
          }
        }
        // ORS_* sentinels or any other failure — surface a plain message, never throw.
        return {
          error:
            'I couldn\'t build a route right now. Tell the athlete to try a different distance or start point, or try again shortly.',
        }
      }
    },
  })

  // ─── generatePlan ───────────────────────────────────────────────────────
  const generatePlan = createTool({
    id: 'generatePlan',
    description:
      'Build a periodized multi-week training plan toward the athlete\'s goal and save it (it appears on the Plan page). ' +
      'TWO-STEP CONFIRMATION: first call with confirmed=false to get what would be created (goal, goal date, whether it replaces an existing plan), ' +
      'read that back and ask the athlete to confirm. Only after they say yes, call again with confirmed=true. Generation takes up to a minute. ' +
      'Ask whether they have constraints (days they cannot train, e.g. "not Tuesdays", or wishes like "1 leisure session per week") and pass them as unavailableWeekdays / notes. ' +
      'RACE: ask for the race DISTANCE (5k, 10k, half, marathon or other with its km), the race DATE and an optional goal time, and pass them as raceDistance, raceDistanceKm (other only), goalDate and targetTimeMinutes (total minutes). ' +
      'Never work out the distance or time from the free-text goal; if the athlete has not said them, ask. The race always lands on the race date, even a weekday they do not normally train. ' +
      'The tool applies suggested limits for the distance (peak weekly km, longest run, taper days); read them back and pass maxWeeklyKm, maxLongRunKm or taperDays only when the athlete asks to change them. ' +
      'Pass goalDate as YYYY-MM-DD when the athlete gave a target date or race (resolve "November" etc. against today\'s date, and confirm it); null if none. ' +
      'After it succeeds, summarise briefly (title, dates, number of weeks and sessions). Do NOT list every session; point them to the Plan page.',
    // gotcha #36: nullable+default(null), never bare .optional(); no refinements.
    inputSchema: z.object({
      confirmed: z.boolean().default(false).describe('false = preview for confirmation; true = generate and save'),
      goal: z
        .string()
        .nullable()
        .default(null)
        .describe('Goal in the athlete\'s words (e.g. "marathon in 3h30"); null = use the saved profile goal.'),
      goalDate: z
        .string()
        .nullable()
        .default(null)
        .describe('Goal/race date as YYYY-MM-DD; null = a general 12-week block.'),
      unavailableWeekdays: z
        .array(z.string())
        .nullable()
        .default(null)
        .describe('Weekdays the athlete cannot train, lowercase English names (e.g. ["tuesday"]); null = none. Strictly enforced.'),
      notes: z
        .string()
        .nullable()
        .default(null)
        .describe('Other constraints in the athlete\'s words (e.g. "1 leisure session per week", "no hard runs in May"); null = none. Best effort.'),
      raceDistance: z
        .enum(RACE_DISTANCES)
        .nullable()
        .default(null)
        .describe('Race distance the athlete chose: 5k, 10k, half, marathon or other; null = no specific race. Never guess it from free text.'),
      raceDistanceKm: z
        .number()
        .nullable()
        .default(null)
        .describe('Race length in km, only when raceDistance is "other" (3 to 100); null otherwise.'),
      targetTimeMinutes: z
        .number()
        .nullable()
        .default(null)
        .describe('Goal finish time as TOTAL minutes (e.g. 40 for 40:00, 210 for 3:30:00); null = no goal time.'),
      maxWeeklyKm: z.number().nullable().default(null).describe('Athlete override of the peak weekly km; null = use the suggested value.'),
      maxLongRunKm: z.number().nullable().default(null).describe('Athlete override of the longest run in km; null = use the suggested value.'),
      taperDays: z.number().nullable().default(null).describe('Athlete override of the taper length in days; null = use the suggested value.'),
    }),
    execute: async (inputData) => {
      const goal =
        typeof inputData.goal === 'string' && inputData.goal.trim() ? inputData.goal.trim() : null
      const goalDate =
        typeof inputData.goalDate === 'string' && inputData.goalDate.trim()
          ? inputData.goalDate.trim()
          : null
      if (goalDate && !isIsoDate(goalDate)) {
        return { created: false, error: 'goalDate must be a real date formatted YYYY-MM-DD. Ask the athlete for the date.' }
      }
      if (inputData.raceDistance == null && (inputData.raceDistanceKm != null || inputData.targetTimeMinutes != null)) {
        return { created: false, error: 'Ask the athlete which race distance this is (5k, 10k, half, marathon or other).' }
      }
      const race =
        inputData.raceDistance == null
          ? null
          : {
              distance: inputData.raceDistance,
              distanceKm: inputData.raceDistanceKm,
              targetTimeS: inputData.targetTimeMinutes != null ? Math.round(inputData.targetTimeMinutes * 60) : null,
            }
      const parsedConstraints = parseConstraints({
        unavailableWeekdays: inputData.unavailableWeekdays,
        notes: inputData.notes,
        race,
        limits: {
          maxWeeklyKm: inputData.maxWeeklyKm,
          maxLongRunKm: inputData.maxLongRunKm,
          taperDays: inputData.taperDays,
        },
      })
      if (!parsedConstraints.ok) return { created: false, error: parsedConstraints.error }
      const constraints = parsedConstraints.value
      if (constraints.race && !goalDate) {
        return { created: false, error: 'Ask the athlete for the race date (YYYY-MM-DD).' }
      }
      const limits = resolveLimits(constraints.race, constraints.limits)

      if (!inputData.confirmed) {
        const { data: existing } = await supabase
          .from('training_plans')
          .select('title, end_date')
          .eq('user_id', userId)
          .eq('status', 'active')
          .limit(1)
          .maybeSingle()
        return {
          created: false,
          needsConfirmation: true,
          willCreate: { goal: goal ?? 'the goal saved on the athlete profile', goalDate: goalDate ?? 'none (general 12-week block)',
            constraints: hasConstraints(constraints) ? constraints : 'none',
            race: constraints.race
              ? {
                  distance: constraints.race.distance,
                  distanceKm: formatRaceKm(constraints.race.distanceKm),
                  targetTime: constraints.race.targetTimeS ? formatTargetTime(constraints.race.targetTimeS) : 'none',
                  raceDate: goalDate,
                  raceWeekday: goalDate ? WEEKDAY_NAMES[weekdayIndex(goalDate)] : null,
                  note: 'The race is scheduled on this date even if it is not one of the athlete\'s usual training days.',
                }
              : 'none',
            limits: {
              maxWeeklyKm: limits.maxWeeklyKm,
              maxLongRunKm: limits.maxLongRunKm,
              taperDays: constraints.race ? limits.taperDays : 'not used without a race',
              suggestedDefaults: limits.defaults,
              allowedRange: limits.bounds,
            } },
          replacesActivePlan: existing ? { title: existing.title, endDate: existing.end_date } : null,
          message:
            'Read this back to the athlete and ask them to confirm. Mention that an existing active plan would be archived. Then call again with confirmed=true.',
        }
      }

      try {
        const r = await generateTrainingPlan(supabase, userId, { goal, goalDate, timeZone, constraints })
        return {
          created: true,
          planId: r.planId,
          title: r.title,
          startDate: r.startDate,
          endDate: r.endDate,
          weeks: r.weeks,
          sessionCount: r.sessionCount,
          replacedPreviousPlan: r.archivedPlanIds.length > 0,
          adjustments: r.adjustments,
          race: r.race
            ? { distanceKm: formatRaceKm(r.race.distanceKm), targetTime: r.race.targetTimeS ? formatTargetTime(r.race.targetTimeS) : 'none', date: r.endDate }
            : null,
          baselineReduced: baselineReducedNote(r.recap.baseline.weeklyKm, r.limits.maxWeeklyKm) !== '',
          limits: { maxWeeklyKm: r.limits.maxWeeklyKm, maxLongRunKm: r.limits.maxLongRunKm, taperDays: r.race ? r.limits.taperDays : null },
          basedOn: {
            weeksUsed: r.recap.qualifyingWeeks,
            weeksAnalysed: r.recap.weeks.length,
            startingWeeklyKm: r.recap.baseline.weeklyKm,
            historySparse: r.recap.sparse,
          },
          message:
            baselineReducedNote(r.recap.baseline.weeklyKm, r.limits.maxWeeklyKm) +
            (r.adjustments.length
              ? `Adjusted ${r.adjustments.length} ${r.adjustments.length === 1 ? 'week' : 'weeks'} to keep weekly increases under 10%; mention this briefly. `
              : '') + (r.recap.sparse
                ? 'History was sparse, so the plan starts conservatively; say so. '
                : `Based on ${r.recap.qualifyingWeeks} of ${r.recap.weeks.length} recent weeks, starting near ${r.recap.baseline.weeklyKm} km/week; mention this. `) +
              'Plan saved. Summarise briefly and point the athlete to the Plan page.',
        }
      } catch (err) {
        if (err instanceof PlanGenerationError) {
          return { created: false, error: err.message, code: err.code }
        }
        return { created: false, error: 'I could not generate a plan right now. Try again shortly.' }
      }
    },
  })

  // ─── adjustUpcomingSessions ─────────────────────────────────────────────
  const adjustUpcomingSessions = createTool({
    id: 'adjustUpcomingSessions',
    description:
      'Change FUTURE planned sessions that are still editable, i.e. pending or moved and not yet completed (e.g. after a missed week, low readiness or an injury): ' +
      'move a date, or change type, description, distance, duration or HR zone. Past, completed or skipped sessions are refused. ' +
      'Get real session ids from getPlannedSessions first. Tell the athlete what you changed and why; to mark a session done or skipped use updateSessionStatus instead.',
    inputSchema: z.object({
      adjustments: z
        .array(
          z.object({
            sessionId: z.string().describe('Planned session UUID from getPlannedSessions'),
            scheduledDate: z.string().nullable().default(null).describe('New date YYYY-MM-DD; null to keep'),
            sessionType: z.string().nullable().default(null),
            description: z.string().nullable().default(null),
            targetDistanceM: z.number().nullable().default(null).describe('Metres; null to keep'),
            targetDurationS: z.number().nullable().default(null).describe('Seconds; null to keep'),
            targetHrZone: z.number().nullable().default(null).describe('1-5; null to keep'),
            reason: z.string().nullable().default(null).describe('Short reason, saved as a note'),
          })
        )
        .default([]),
    }),
    execute: async (inputData) => {
      const adjustments = Array.isArray(inputData.adjustments) ? inputData.adjustments : []
      if (!adjustments.length) {
        return { adjusted: [], rejected: [], message: 'No adjustments were provided.' }
      }
      try {
        const today = await getAthleteToday(supabase, userId, new Date(), timeZone)
        const outcome = await adjustUpcomingSessionsSvc(supabase, userId, adjustments, today)
        return { ...outcome, today }
      } catch {
        return { adjusted: [], rejected: [], error: 'Failed to adjust sessions. Try again shortly.' }
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
    suggestRoute,
    generatePlan,
    adjustUpcomingSessions,
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
