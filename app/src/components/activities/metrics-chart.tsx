'use client'

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts'
import { formatDuration, formatPace } from '@/lib/utils'

interface StreamPoint {
  t: number
  v: number | [number, number]
}

interface MetricsChartProps {
  title: string
  points: StreamPoint[]
  color: string
  /** How to render the Y value in tooltip/axis */
  kind: 'hr' | 'pace' | 'cadence' | 'altitude' | 'power'
  unit?: string
}

export function MetricsChart({ title, points, color, kind, unit }: MetricsChartProps) {
  if (!points.length) return null

  // Downsample to ~300 points max for performance
  const step = Math.max(1, Math.floor(points.length / 300))
  const data = points
    .filter((_, i) => i % step === 0)
    .map((p) => ({ t: p.t, v: typeof p.v === 'number' ? p.v : null }))
    .filter((d) => d.v !== null)

  const formatY = (v: number) => {
    if (kind === 'pace') return formatPace(v).replace(' /km', '')
    return `${v}${unit ? unit : ''}`
  }

  return (
    <div>
      <p className="text-sm font-medium mb-2 text-[var(--foreground)]">{title}</p>
      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.4} />
          <XAxis
            dataKey="t"
            tickFormatter={(t) => formatDuration(t)}
            tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
            minTickGap={40}
          />
          <YAxis
            tickFormatter={formatY}
            tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
            width={44}
            reversed={kind === 'pace'}
            domain={['auto', 'auto']}
          />
          <Tooltip
            labelFormatter={(t) => `@ ${formatDuration(Number(t))}`}
            formatter={(v) => [formatY(Number(v)), title]}
            contentStyle={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              fontSize: 12,
            }}
          />
          <Line
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
