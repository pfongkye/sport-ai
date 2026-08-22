'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

const SPORTS = [
  { id: 'run', label: 'Running', emoji: '🏃' },
  { id: 'football', label: 'Football', emoji: '⚽' },
  { id: 'gym', label: 'Gym', emoji: '🏋️' },
  { id: 'cycle', label: 'Cycling', emoji: '🚴' },
]

const DAYS = [
  { id: 'monday', label: 'Mon' },
  { id: 'tuesday', label: 'Tue' },
  { id: 'wednesday', label: 'Wed' },
  { id: 'thursday', label: 'Thu' },
  { id: 'friday', label: 'Fri' },
  { id: 'saturday', label: 'Sat' },
  { id: 'sunday', label: 'Sun' },
]

interface OnboardingFormProps {
  userId: string
}

export function OnboardingForm({ userId }: OnboardingFormProps) {
  const router = useRouter()
  const supabase = createClient()

  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState({
    displayName: '',
    dateOfBirth: '',
    weightKg: '',
    heightCm: '',
    primaryGoal: '',
    sportPrefs: ['run'] as string[],
    trainingDays: ['monday', 'wednesday', 'friday', 'saturday'] as string[],
  })

  function toggleSport(sport: string) {
    setForm((f) => ({
      ...f,
      sportPrefs: f.sportPrefs.includes(sport)
        ? f.sportPrefs.filter((s) => s !== sport)
        : [...f.sportPrefs, sport],
    }))
  }

  function toggleDay(day: string) {
    setForm((f) => ({
      ...f,
      trainingDays: f.trainingDays.includes(day)
        ? f.trainingDays.filter((d) => d !== day)
        : [...f.trainingDays, day],
    }))
  }

  async function handleSubmit() {
    if (!form.displayName.trim()) {
      setError('Please enter your name.')
      return
    }
    if (!form.primaryGoal.trim()) {
      setError('Please enter your primary goal.')
      return
    }
    if (form.sportPrefs.length === 0) {
      setError('Please select at least one sport.')
      return
    }

    setLoading(true)
    setError(null)

    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        display_name: form.displayName.trim(),
        date_of_birth: form.dateOfBirth || null,
        weight_kg: form.weightKg ? parseFloat(form.weightKg) : null,
        height_cm: form.heightCm ? parseFloat(form.heightCm) : null,
        primary_goal: form.primaryGoal.trim(),
        sport_prefs: form.sportPrefs,
        training_days: form.trainingDays,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId)

    if (updateError) {
      setError('Failed to save profile. Please try again.')
      setLoading(false)
      return
    }

    router.push('/dashboard')
  }

  return (
    <div className="space-y-6">
      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {[1, 2].map((s) => (
          <div
            key={s}
            className={cn(
              'h-1.5 flex-1 rounded-full transition-colors',
              step >= s ? 'bg-[var(--primary)]' : 'bg-[var(--border)]'
            )}
          />
        ))}
      </div>

      {error && (
        <div role="alert" className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {step === 1 && (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="displayName">Your name</Label>
            <Input
              id="displayName"
              placeholder="Pascal"
              value={form.displayName}
              onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="weightKg">Weight (kg)</Label>
              <Input
                id="weightKg"
                type="number"
                placeholder="75"
                value={form.weightKg}
                onChange={(e) => setForm((f) => ({ ...f, weightKg: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="heightCm">Height (cm)</Label>
              <Input
                id="heightCm"
                type="number"
                placeholder="178"
                value={form.heightCm}
                onChange={(e) => setForm((f) => ({ ...f, heightCm: e.target.value }))}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="dateOfBirth">Date of birth</Label>
            <Input
              id="dateOfBirth"
              type="date"
              value={form.dateOfBirth}
              onChange={(e) => setForm((f) => ({ ...f, dateOfBirth: e.target.value }))}
            />
          </div>

          <div className="space-y-3">
            <Label>Sports you do</Label>
            <div className="grid grid-cols-2 gap-2">
              {SPORTS.map((sport) => (
                <button
                  key={sport.id}
                  type="button"
                  onClick={() => toggleSport(sport.id)}
                  className={cn(
                    'flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors',
                    form.sportPrefs.includes(sport.id)
                      ? 'border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)]'
                      : 'border-[var(--border)] hover:bg-[var(--muted)]'
                  )}
                  aria-pressed={form.sportPrefs.includes(sport.id)}
                >
                  <span aria-hidden>{sport.emoji}</span>
                  {sport.label}
                </button>
              ))}
            </div>
          </div>

          <Button className="w-full" onClick={() => setStep(2)} disabled={!form.displayName.trim()}>
            Next
          </Button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="primaryGoal">Primary goal</Label>
            <Input
              id="primaryGoal"
              placeholder="e.g. Marathon in 3h30, November 2026"
              value={form.primaryGoal}
              onChange={(e) => setForm((f) => ({ ...f, primaryGoal: e.target.value }))}
              autoFocus
            />
            <p className="text-xs text-[var(--muted-foreground)]">
              Be specific — your AI coach will use this to build your training plan.
            </p>
          </div>

          <div className="space-y-3">
            <Label>Training days</Label>
            <div className="flex gap-1.5 flex-wrap">
              {DAYS.map((day) => (
                <button
                  key={day.id}
                  type="button"
                  onClick={() => toggleDay(day.id)}
                  className={cn(
                    'rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                    form.trainingDays.includes(day.id)
                      ? 'border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)]'
                      : 'border-[var(--border)] hover:bg-[var(--muted)]'
                  )}
                  aria-pressed={form.trainingDays.includes(day.id)}
                >
                  {day.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={() => setStep(1)}>
              Back
            </Button>
            <Button
              className="flex-1"
              onClick={handleSubmit}
              disabled={loading || !form.primaryGoal.trim()}
            >
              {loading ? 'Saving…' : 'Start training'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
