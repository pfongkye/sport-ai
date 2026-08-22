'use client'

import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { http } from '@/lib/http'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

const MD_CLASSES =
  'markdown text-sm [&_p]:my-1.5 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_ul]:my-1.5 [&_ul]:pl-4 [&_ul]:list-disc [&_strong]:font-semibold'

export function ActivityInsight({ activityId }: { activityId: string }) {
  const [insight, setInsight] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)

  // Load an existing insight if one was already generated
  useEffect(() => {
    http(`/api/activities/${activityId}/insight`)
      .then((r) => (r.ok ? r.json() : { insight: null }))
      .then((d) => setInsight(d.insight ?? null))
      .catch(() => setInsight(null))
      .finally(() => setLoading(false))
  }, [activityId])

  async function generate() {
    setGenerating(true)
    setInsight('')
    try {
      const res = await http(`/api/activities/${activityId}/insight`, { method: 'POST' })
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: 'Failed' }))
        setInsight(`⚠️ ${err.error ?? 'Could not generate insight'}`)
        return
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let acc = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        acc += decoder.decode(value, { stream: true })
        setInsight(acc)
      }
    } catch (err) {
      setInsight(`⚠️ ${err instanceof Error ? err.message : 'Network error'}`)
    } finally {
      setGenerating(false)
    }
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h2 className="font-semibold text-[var(--foreground)] flex items-center gap-2">
            <span aria-hidden>🤖</span> Coach insight
          </h2>
          {!loading && (
            <Button variant="outline" size="sm" onClick={generate} disabled={generating}>
              {generating ? 'Analysing…' : insight ? 'Regenerate' : 'Analyse'}
            </Button>
          )}
        </div>

        {loading ? (
          <p className="text-sm text-[var(--muted-foreground)]">Loading…</p>
        ) : insight ? (
          <div className={MD_CLASSES}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{insight}</ReactMarkdown>
          </div>
        ) : (
          <p className="text-sm text-[var(--muted-foreground)]">
            Get a quick AI analysis of this session — pacing, effort, and what to focus on next.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
