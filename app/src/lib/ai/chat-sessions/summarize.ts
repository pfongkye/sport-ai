import { generateText } from 'ai'
import { resolveUserAISettings, resolveModel } from '@/lib/ai/provider'

export const SUMMARY_TIMEOUT_MS = 40_000
export const MAX_TRANSCRIPT_CHARS = 24_000
export const MAX_SUMMARY_CHARS = 1200

export interface TranscriptMessage {
  role: string
  content: string
}

/** Transcript text, keeping only the most recent MAX_TRANSCRIPT_CHARS. */
export function buildTranscript(messages: TranscriptMessage[]): string {
  const text = messages
    .map((m) => `${m.role === 'user' ? 'Athlete' : 'Coach'}: ${m.content.trim()}`)
    .join('\n\n')
  return text.length > MAX_TRANSCRIPT_CHARS ? text.slice(text.length - MAX_TRANSCRIPT_CHARS) : text
}

/** Pure prompt builder for the summary call. */
export function buildSummaryPrompt(messages: TranscriptMessage[]): { system: string; prompt: string } {
  const system = [
    'You compact a finished coaching chat into a short note the coach can reuse later.',
    'Keep ONLY durable coaching facts: goals, injuries and health limits, preferences, decisions made, constraints (schedule, equipment), and open commitments.',
    'Drop greetings, small talk, one-off questions, and anything already obvious from the training data.',
    'Never invent facts. If the chat has nothing durable, say so in one sentence.',
    `Write plain text, bullet points allowed, at most ${MAX_SUMMARY_CHARS} characters. No preamble.`,
  ].join('\n')
  return { system, prompt: `Chat transcript:\n\n${buildTranscript(messages)}` }
}

/** Real summarizer: one generateText call with the user's provider, bounded by a timeout. */
export async function summarizeChat(userId: string, messages: TranscriptMessage[]): Promise<string> {
  const { settings, userApiKey } = await resolveUserAISettings(userId)
  const model = resolveModel(
    settings?.ai_provider ?? 'openai',
    settings?.ai_model ?? 'gpt-4o',
    userApiKey
  )
  const { system, prompt } = buildSummaryPrompt(messages)
  const { text } = await generateText({
    model,
    system,
    prompt,
    abortSignal: AbortSignal.timeout(SUMMARY_TIMEOUT_MS),
  })
  const out = text.trim()
  if (!out) throw new Error('Empty summary')
  return out.length > MAX_SUMMARY_CHARS ? `${out.slice(0, MAX_SUMMARY_CHARS - 1)}…` : out
}
