/**
 * A small, dependency-free elevation chart drawn as inline SVG from the route's
 * `elevationProfile` ({ distM, eleM }[]). Mobile-first and accessible: labelled
 * min/max axes plus a screen-reader-only text summary. No hover-only
 * affordances (gotcha #23) — all information is visible/readable without hover.
 */

interface ElevationPoint {
  distM: number
  eleM: number
}

interface ElevationProfileProps {
  profile: ElevationPoint[]
}

const WIDTH = 320
const HEIGHT = 96
const PAD_X = 4
const PAD_Y = 8

export function ElevationProfile({ profile }: ElevationProfileProps) {
  if (!profile || profile.length < 2) return null

  const eles = profile.map((p) => p.eleM)
  const minEle = Math.min(...eles)
  const maxEle = Math.max(...eles)
  const maxDist = profile[profile.length - 1].distM || 1
  const eleRange = maxEle - minEle || 1

  const innerW = WIDTH - PAD_X * 2
  const innerH = HEIGHT - PAD_Y * 2

  const x = (d: number) => PAD_X + (d / maxDist) * innerW
  const y = (e: number) => PAD_Y + (1 - (e - minEle) / eleRange) * innerH

  const linePoints = profile.map((p) => `${x(p.distM).toFixed(1)},${y(p.eleM).toFixed(1)}`)
  const areaPath =
    `M ${x(profile[0].distM).toFixed(1)},${(HEIGHT - PAD_Y).toFixed(1)} ` +
    linePoints.map((pt) => `L ${pt}`).join(' ') +
    ` L ${x(maxDist).toFixed(1)},${(HEIGHT - PAD_Y).toFixed(1)} Z`

  const distKm = (maxDist / 1000).toFixed(1)
  const gain = Math.round(maxEle - minEle)

  return (
    <figure className="space-y-1">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full h-24"
        preserveAspectRatio="none"
        aria-hidden
      >
        <path d={areaPath} fill="#f97316" fillOpacity={0.12} />
        <polyline
          points={linePoints.join(' ')}
          fill="none"
          stroke="#f97316"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="flex justify-between text-xs text-[var(--muted-foreground)]">
        <span>{Math.round(minEle)} m</span>
        <span>
          {distKm} km · {gain} m range
        </span>
        <span>{Math.round(maxEle)} m</span>
      </div>
      <figcaption className="sr-only">
        Elevation profile over {distKm} kilometers, ranging from {Math.round(minEle)} to{' '}
        {Math.round(maxEle)} meters ({gain} meters of variation).
      </figcaption>
    </figure>
  )
}
