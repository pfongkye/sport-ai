/**
 * Auto-generated Supabase database types.
 * Re-generate after schema changes with:
 *   npx supabase gen types typescript --local > src/types/database.ts
 *
 * NOTE: Until the local Supabase instance is running, these types are
 * manually maintained. Run `npm run db:types` after starting Docker to sync.
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Database = any

export type _Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          display_name: string | null
          avatar_url: string | null
          date_of_birth: string | null
          weight_kg: number | null
          height_cm: number | null
          sport_prefs: string[] | null
          primary_goal: string | null
          training_days: string[] | null
          home_lat: number | null
          home_lng: number | null
          home_label: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          display_name?: string | null
          avatar_url?: string | null
          date_of_birth?: string | null
          weight_kg?: number | null
          height_cm?: number | null
          sport_prefs?: string[] | null
          primary_goal?: string | null
          training_days?: string[] | null
          home_lat?: number | null
          home_lng?: number | null
          home_label?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          display_name?: string | null
          avatar_url?: string | null
          date_of_birth?: string | null
          weight_kg?: number | null
          height_cm?: number | null
          sport_prefs?: string[] | null
          primary_goal?: string | null
          training_days?: string[] | null
          home_lat?: number | null
          home_lng?: number | null
          home_label?: string | null
          updated_at?: string
        }
      }
      suggested_routes: {
        Row: {
          id: string
          user_id: string
          planned_session_id: string | null
          requested_distance_m: number
          distance_m: number
          ascent_m: number
          descent_m: number
          terrain: RouteTerrain
          start_lat: number
          start_lng: number
          start_label: string | null
          geometry: Json
          elevation_profile: Json
          bbox: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          planned_session_id?: string | null
          requested_distance_m: number
          distance_m: number
          ascent_m: number
          descent_m: number
          terrain: RouteTerrain
          start_lat: number
          start_lng: number
          start_label?: string | null
          geometry: Json
          elevation_profile: Json
          bbox: Json
          created_at?: string
          updated_at?: string
        }
        Update: {
          planned_session_id?: string | null
          requested_distance_m?: number
          distance_m?: number
          ascent_m?: number
          descent_m?: number
          terrain?: RouteTerrain
          start_lat?: number
          start_lng?: number
          start_label?: string | null
          geometry?: Json
          elevation_profile?: Json
          bbox?: Json
          updated_at?: string
        }
      }
      activities: {
        Row: {
          id: string
          user_id: string
          source: ActivitySource
          external_id: string | null
          sport_type: SportType
          started_at: string
          duration_s: number | null
          distance_m: number | null
          elevation_gain_m: number | null
          avg_hr_bpm: number | null
          max_hr_bpm: number | null
          avg_pace_s_per_km: number | null
          avg_cadence_rpm: number | null
          calories_kcal: number | null
          training_load: number | null
          rpe: number | null
          notes: string | null
          file_url: string | null
          raw_data: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          source: ActivitySource
          external_id?: string | null
          sport_type: SportType
          started_at: string
          duration_s?: number | null
          distance_m?: number | null
          elevation_gain_m?: number | null
          avg_hr_bpm?: number | null
          max_hr_bpm?: number | null
          avg_pace_s_per_km?: number | null
          avg_cadence_rpm?: number | null
          calories_kcal?: number | null
          training_load?: number | null
          rpe?: number | null
          notes?: string | null
          file_url?: string | null
          raw_data?: Json | null
          created_at?: string
        }
        Update: {
          sport_type?: SportType
          started_at?: string
          duration_s?: number | null
          distance_m?: number | null
          elevation_gain_m?: number | null
          avg_hr_bpm?: number | null
          max_hr_bpm?: number | null
          avg_pace_s_per_km?: number | null
          avg_cadence_rpm?: number | null
          calories_kcal?: number | null
          training_load?: number | null
          rpe?: number | null
          notes?: string | null
          raw_data?: Json | null
        }
      }
      activity_streams: {
        Row: {
          id: string
          activity_id: string
          user_id: string
          stream_type: StreamType
          data: Json
          created_at: string
        }
        Insert: {
          id?: string
          activity_id: string
          user_id: string
          stream_type: StreamType
          data: Json
          created_at?: string
        }
        Update: {
          data?: Json
        }
      }
      training_plans: {
        Row: {
          id: string
          user_id: string
          title: string
          goal: string | null
          start_date: string
          end_date: string
          status: PlanStatus
          /** Training recap snapshot (migration 016); null for older plans. */
          recap: Json | null
          /** Athlete constraints (migration 017); null when none. */
          constraints: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          title: string
          goal?: string | null
          start_date: string
          end_date: string
          status?: PlanStatus
          recap?: Json | null
          constraints?: Json | null
          created_at?: string
        }
        Update: {
          title?: string
          goal?: string | null
          end_date?: string
          status?: PlanStatus
          recap?: Json | null
          constraints?: Json | null
        }
      }
      planned_sessions: {
        Row: {
          id: string
          plan_id: string
          user_id: string
          scheduled_date: string
          sport_type: SportType
          session_type: string | null
          description: string | null
          target_distance_m: number | null
          target_duration_s: number | null
          target_hr_zone: number | null
          status: SessionStatus
          completed_activity_id: string | null
          ai_notes: string | null
          created_at: string
        }
        Insert: {
          id?: string
          plan_id: string
          user_id: string
          scheduled_date: string
          sport_type: SportType
          session_type?: string | null
          description?: string | null
          target_distance_m?: number | null
          target_duration_s?: number | null
          target_hr_zone?: number | null
          status?: SessionStatus
          completed_activity_id?: string | null
          ai_notes?: string | null
          created_at?: string
        }
        Update: {
          scheduled_date?: string
          session_type?: string | null
          description?: string | null
          target_distance_m?: number | null
          target_duration_s?: number | null
          target_hr_zone?: number | null
          status?: SessionStatus
          completed_activity_id?: string | null
          ai_notes?: string | null
        }
      }
      coaching_messages: {
        Row: {
          id: string
          user_id: string
          role: MessageRole
          content: string
          audio_url: string | null
          metadata: Json | null
          embedding: string | null
          session_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          role: MessageRole
          content: string
          audio_url?: string | null
          metadata?: Json | null
          embedding?: string | null
          session_id?: string | null
          created_at?: string
        }
        Update: {
          content?: string
          metadata?: Json | null
          embedding?: string | null
        }
      }
      coach_sessions: {
        Row: {
          id: string
          user_id: string
          title: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          title?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          title?: string
          updated_at?: string
        }
      }
      coach_memories: {
        Row: {
          id: string
          user_id: string
          title: string
          summary: string
          message_count: number | null
          source_started_at: string | null
          source_ended_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          title?: string
          summary: string
          message_count?: number | null
          source_started_at?: string | null
          source_ended_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          title?: string
          summary?: string
          updated_at?: string
        }
      }
      nutrition_logs: {
        Row: {
          id: string
          user_id: string
          logged_at: string
          meal_type: MealType | null
          photo_url: string | null
          ai_identified: Json | null
          user_corrected: Json | null
          macros: Json | null
          notes: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          logged_at?: string
          meal_type?: MealType | null
          photo_url?: string | null
          ai_identified?: Json | null
          user_corrected?: Json | null
          macros?: Json | null
          notes?: string | null
          created_at?: string
        }
        Update: {
          logged_at?: string
          meal_type?: MealType | null
          ai_identified?: Json | null
          user_corrected?: Json | null
          macros?: Json | null
          notes?: string | null
        }
      }
      user_settings: {
        Row: {
          user_id: string
          ai_provider: AIProvider
          ai_model: string
          ai_api_key_enc: string | null
          units: Units
          language: string
          timezone: string
          updated_at: string
        }
        Insert: {
          user_id: string
          ai_provider?: AIProvider
          ai_model?: string
          ai_api_key_enc?: string | null
          units?: Units
          language?: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          ai_provider?: AIProvider
          ai_model?: string
          ai_api_key_enc?: string | null
          units?: Units
          language?: string
          timezone?: string
          updated_at?: string
        }
      }
    }
    Views: Record<string, never>
    Functions: {
      encrypt_api_key: {
        Args: { key_text: string }
        Returns: string
      }
      decrypt_api_key: {
        Args: { key_enc: string }
        Returns: string
      }
    }
    Enums: Record<string, never>
  }
}

// ─── Domain types ────────────────────────────────────────────────────────────

export type ActivitySource =
  | 'upload_fit'
  | 'upload_gpx'
  | 'upload_tcx'
  | 'strava'
  | 'garmin'
  | 'coros'
  | 'manual'

export type SportType = 'run' | 'football' | 'gym' | 'cycle' | 'other'

export type StreamType = 'heartrate' | 'pace' | 'cadence' | 'altitude' | 'latlng' | 'power'

export type PlanStatus = 'active' | 'completed' | 'archived'

export type SessionStatus = 'pending' | 'completed' | 'skipped' | 'modified'

export type MessageRole = 'user' | 'assistant' | 'system'

export type MealType =
  | 'breakfast'
  | 'lunch'
  | 'dinner'
  | 'snack'
  | 'pre-workout'
  | 'post-workout'

export type AIProvider = 'openai' | 'anthropic' | 'google' | 'mistral'

export type Units = 'metric' | 'imperial'

export type RouteTerrain = 'flat' | 'uphill'

// ─── Explicit row types (used throughout the app) ───────────────────────────
// Defined explicitly so they remain typed even while Database = any during dev.

export interface Profile {
  id: string
  display_name: string | null
  avatar_url: string | null
  date_of_birth: string | null
  weight_kg: number | null
  height_cm: number | null
  sport_prefs: string[] | null
  primary_goal: string | null
  training_days: string[] | null
  home_lat: number | null
  home_lng: number | null
  home_label: string | null
  created_at: string
  updated_at: string
}

export interface Activity {
  id: string
  user_id: string
  source: ActivitySource
  external_id: string | null
  sport_type: SportType
  started_at: string
  duration_s: number | null
  distance_m: number | null
  elevation_gain_m: number | null
  avg_hr_bpm: number | null
  max_hr_bpm: number | null
  avg_pace_s_per_km: number | null
  avg_cadence_rpm: number | null
  calories_kcal: number | null
  training_load: number | null
  rpe: number | null
  notes: string | null
  file_url: string | null
  raw_data: Json | null
  created_at: string
}

export interface ActivityStream {
  id: string
  activity_id: string
  user_id: string
  stream_type: StreamType
  data: Json
  created_at: string
}

export interface TrainingPlan {
  id: string
  user_id: string
  title: string
  goal: string | null
  start_date: string
  end_date: string
  status: PlanStatus
  /** Training recap snapshot (migration 016); null for plans created before it. */
  recap: Json | null
  /** Athlete constraints (migration 017); null when none. */
  constraints: Json | null
  created_at: string
}

export interface PlannedSession {
  id: string
  plan_id: string
  user_id: string
  scheduled_date: string
  sport_type: SportType
  session_type: string | null
  description: string | null
  target_distance_m: number | null
  target_duration_s: number | null
  target_hr_zone: number | null
  status: SessionStatus
  completed_activity_id: string | null
  ai_notes: string | null
  created_at: string
}

export interface CoachingMessage {
  id: string
  user_id: string
  role: MessageRole
  content: string
  audio_url: string | null
  metadata: Json | null
  embedding: string | null
  created_at: string
}

export interface NutritionLog {
  id: string
  user_id: string
  logged_at: string
  meal_type: MealType | null
  photo_url: string | null
  ai_identified: Json | null
  user_corrected: Json | null
  macros: Json | null
  notes: string | null
  created_at: string
}

export interface UserSettings {
  user_id: string
  ai_provider: AIProvider
  ai_model: string
  ai_api_key_enc: string | null
  units: Units
  language: string
  timezone: string
  updated_at: string
}

export interface SuggestedRoute {
  id: string
  user_id: string
  planned_session_id: string | null
  requested_distance_m: number
  distance_m: number
  ascent_m: number
  descent_m: number
  terrain: RouteTerrain
  start_lat: number
  start_lng: number
  start_label: string | null
  /** GeoJSON LineString ([lng,lat,ele][]). Typed as Json since Database = any. */
  geometry: Json
  /** [{ distM, eleM }] sampled elevation profile. */
  elevation_profile: Json
  /** [minLng, minLat, maxLng, maxLat]. */
  bbox: Json
  created_at: string
  updated_at: string
}

export type NoteSource = 'voice' | 'text'

export interface ActivityNote {
  id: string
  user_id: string
  activity_id: string
  transcript: string
  source: NoteSource
  duration_s: number | null
  audio_url: string | null
  embedding: string | null
  message_id: string | null
  created_at: string
}
