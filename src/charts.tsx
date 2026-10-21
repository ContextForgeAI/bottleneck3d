import { useState, type CSSProperties } from 'react'
import type { AnalysisResult, FlowStats, LayerTime } from './domain/result'
import {
  formatDelta,
  formatLength,
  formatNumber,
  formatPercent,
  formatTime,
  roleColor,
  roleLabel,
  share,
  shortTime,
} from './format'
import { useI18n } from './i18n'
import { CATEGORIES, type Category, type CategoryTimes } from './insights'

const sumTimes = (times: CategoryTimes) => CATEGORIES.reduce((sum, id) => sum + times[id], 0)

/** Stacked bar of the time categories; `scaleTo` shrinks it relative to a reference total. */
export function CategoryBar({
  times,
  scaleTo,
  active,
  thin = false,
}: {
  times: CategoryTimes
  scaleTo?: number
  active?: Category | null
  thin?: boolean
}) {
  const { t } = useI18n()
  const total = Math.max(sumTimes(times), 1e-6)
  const width = scaleTo ? Math.min(100, share(total, scaleTo)) : 100
  return (
    <div className={`stack-track ${thin ? 'is-thin' : ''}`}>
      <div className="stack-bar" style={{ width: `${width}%` }} role="img" aria-label={t.time.composition}>
        {CATEGORIES.map((id) => (
          <i
            key={id}
            className={`tone-${id} ${active && active !== id ? 'is-dim' : ''}`}
            style={{ width: `${share(times[id], total)}%` }}
            title={`${t.categories[id].label}: ${formatTime(times[id])}`}
          />
        ))}
      </div>
    </div>
  )
}

/** Legend rows; with `compareTo` each row shows the change against it. */
export function CategoryList({
  times,
  compareTo,
  active,
  onActive,
  onPick,
}: {
  times: CategoryTimes
  compareTo?: CategoryTimes
  active?: Category | null
  onActive?: (id: Category | null) => void
  onPick?: (id: Category) => void
}) {
  const { t } = useI18n()
  const total = Math.max(sumTimes(times), 1e-6)
  const rows = CATEGORIES.filter(
    (id) => id === 'print' || times[id] >= 1 || (compareTo && compareTo[id] >= 1),
  )
  return (
    <ul className="cat-list" onMouseLeave={() => onActive?.(null)}>
      {rows.map((id) => {
        const delta = compareTo ? times[id] - compareTo[id] : 0
        return (
          <li
            key={id}
            className={`${active === id ? 'is-active' : ''} ${onPick ? 'is-clickable' : ''}`}
            onMouseEnter={() => onActive?.(id)}
            onClick={() => onPick?.(id)}
          >
            <i className={`dot tone-${id}`} />
            <div>
              <span>{t.categories[id].label}</span>
              <small>{t.categories[id].hint}</small>
            </div>
            <b>{formatTime(times[id])}</b>
            {compareTo ? (
              <em className={delta <= -1 ? 'is-good' : delta >= 1 ? 'is-bad' : ''}>
                {formatDelta(delta)}
              </em>
            ) : (
              <em>{formatPercent(share(times[id], total))}</em>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/** Largest-remainder split of 100 cells, so the cells always add up to 100. */
function cellCounts(times: CategoryTimes): Record<Category, number> {
  const total = Math.max(sumTimes(times), 1e-6)
  const raw = CATEGORIES.map((id) => ({ id, exact: (times[id] / total) * 100 }))
  const counts = Object.fromEntries(raw.map((item) => [item.id, Math.floor(item.exact)])) as Record<
    Category,
    number
  >
  let left = 100 - raw.reduce((sum, item) => sum + Math.floor(item.exact), 0)
  for (const item of [...raw].sort((a, b) => (b.exact % 1) - (a.exact % 1))) {
    if (left <= 0) break
    counts[item.id] += 1
    left -= 1
  }
  return counts
}

export function Waffle({
  times,
  active,
  onActive,
}: {
  times: CategoryTimes
  active?: Category | null
  onActive?: (id: Category | null) => void
}) {
  const counts = cellCounts(times)
  const cells = CATEGORIES.flatMap((id) => Array.from({ length: counts[id] }, () => id))
  return (
    <div className="waffle" onMouseLeave={() => onActive?.(null)}>
      {cells.map((id, index) => (
        <i
          key={index}
          className={`tone-${id} ${active && active !== id ? 'is-dim' : ''}`}
          style={{ '--i': index } as CSSProperties}
          onMouseEnter={() => onActive?.(id)}
        />
      ))}
    </div>
  )
}

/** Why short segments are slow: the head never reaches the set speed before braking. */
export function SpeedProfile() {
  const { t } = useI18n()
  const long = 'M 20 92 L 70 30 L 230 30 L 280 92'
  const short = 'M 310 92 L 345 62 L 380 92'
  return (
    <figure className="speed-profile">
      <svg viewBox="0 0 400 110" role="img" aria-label={t.overview.profileLong}>
        <line x1="10" y1="30" x2="395" y2="30" className="target-line" />
        <text x="12" y="22" className="axis-label">{t.overview.profileShort}</text>
        <line x1="10" y1="92" x2="395" y2="92" className="grid-line" />
        <path d={long} className="profile-path" />
        <path d={short} className="profile-path is-short" />
        <circle r="5" className="profile-dot">
          <animateMotion dur="3.2s" repeatCount="indefinite" path={long} />
        </circle>
        <circle r="5" className="profile-dot is-short">
          <animateMotion dur="1.4s" repeatCount="indefinite" path={short} />
        </circle>
      </svg>
      <figcaption>
        <span><i className="dot tone-print" /> {t.overview.profileLong}</span>
        <span><i className="dot tone-mechanics" /> {t.overview.profileShortSeg}</span>
      </figcaption>
    </figure>
  )
}

export function RoleBreakdown({ result }: { result: AnalysisResult }) {
  const { t } = useI18n()
  const roles = result.roles
  const total = roles.reduce((sum, role) => sum + role.seconds, 0)
  if (!total) return null
  const hasMarkers = roles.some((role) => role.kind === 'print' && role.role)
  const shown = roles.slice(0, 8)
  const rest = roles.slice(8).reduce((sum, role) => sum + role.seconds, 0)
  let printIndex = 0
  const colors = roles.map((role) =>
    role.kind === 'print' ? roleColor(role, printIndex++) : roleColor(role, 0),
  )

  return (
    <div className="roles">
      <div className="stack-track">
        <div className="stack-bar">
          {roles.map((role, index) => (
            <i
              key={`${role.kind}-${role.role}`}
              style={{ width: `${share(role.seconds, total)}%`, background: colors[index] }}
              title={`${roleLabel(role)}: ${formatTime(role.seconds)}`}
            />
          ))}
        </div>
      </div>
      <ul className="role-list">
        {shown.map((role, index) => {
          const atSpeed = Math.min(100, share(role.idealSeconds, role.seconds))
          return (
            <li key={`${role.kind}-${role.role}`}>
              <i className="dot" style={{ background: colors[index] }} />
              <span>{roleLabel(role)}</span>
              <div className="role-speed" title={t.time.speedTitle}>
                <i style={{ width: `${atSpeed}%` }} />
              </div>
              <small>
                {formatPercent(atSpeed)} {t.time.atSpeed}
              </small>
              <b>{formatTime(role.seconds)}</b>
              <em>{formatPercent(share(role.seconds, total))}</em>
            </li>
          )
        })}
        {rest > 0 && (
          <li className="is-rest">
            <i className="dot" />
            <span>{t.time.rest}</span>
            <div className="role-speed is-empty" />
            <small />
            <b>{formatTime(rest)}</b>
            <em>{formatPercent(share(rest, total))}</em>
          </li>
        )}
      </ul>
      {!hasMarkers && <p className="muted">{t.time.noMarkers}</p>}
    </div>
  )
}

const CHART_W = 1000
const CHART_H = 240
const PAD = { left: 56, right: 12, top: 14, bottom: 28 }

function niceStep(max: number, ticks: number): number {
  const raw = max / ticks
  const power = 10 ** Math.floor(Math.log10(raw))
  const unit = [1, 2, 5, 10].find((step) => step * power >= raw) ?? 10
  return unit * power
}

export function LayerChart({ layers, wide = false }: { layers: LayerTime[]; wide?: boolean }) {
  const { t } = useI18n()
  const [hover, setHover] = useState<number | null>(null)
  if (layers.length < 2) return null
  const chartW = wide ? CHART_W * 2.2 : CHART_W
  const sorted = [...layers].sort((a, b) => a.seconds - b.seconds)
  const max = Math.max(sorted[sorted.length - 1].seconds, 1)
  const typical = sorted[Math.floor((sorted.length - 1) * 0.97)].seconds
  const scaleMax = max > typical * 3 ? Math.max(typical * 1.6, 1) : max
  const step = niceStep(scaleMax, 4)
  const top = Math.ceil(scaleMax / step) * step
  const innerW = chartW - PAD.left - PAD.right
  const innerH = CHART_H - PAD.top - PAD.bottom
  const barW = innerW / layers.length
  const y = (seconds: number) => PAD.top + innerH - (Math.min(seconds, top) / top) * innerH
  const clipLabels = new Set<number>()
  for (const index of layers
    .map((layer, index) => (layer.seconds > top ? index : -1))
    .filter((index) => index >= 0)
    .sort((a, b) => layers[b].seconds - layers[a].seconds)) {
    if (clipLabels.size >= 4) break
    if ([...clipLabels].every((other) => Math.abs(other - index) * barW > 90)) clipLabels.add(index)
  }
  const median = sorted[Math.floor(sorted.length / 2)].seconds
  const slowest = sorted[sorted.length - 1]
  const active = hover === null ? null : layers[hover]
  const labelEvery = Math.max(1, Math.ceil(layers.length / 10))

  return (
    <div className="chart">
      <div className="chart-stats">
        <span>
          {t.time.median} <b>{formatTime(median)}</b>
        </span>
        <span>
          {t.time.slowest} <b>№{layers.indexOf(slowest) + 1}</b> · Z {formatNumber(slowest.z, 2)} ·{' '}
          <b>{formatTime(slowest.seconds)}</b>
        </span>
        <span className="chart-hover">
          {active
            ? t.time.layerHover(
                hover! + 1,
                formatNumber(active.z, 2),
                formatTime(active.seconds),
                formatTime(active.idealSeconds),
              )
            : t.time.hoverHint}
        </span>
      </div>
      <svg viewBox={`0 0 ${chartW} ${CHART_H}`} className="chart-svg" onMouseLeave={() => setHover(null)}>
        {Array.from({ length: Math.round(top / step) + 1 }, (_, tick) => tick * step).map((value) => (
          <g key={value}>
            <line x1={PAD.left} x2={chartW - PAD.right} y1={y(value)} y2={y(value)} className="grid-line" />
            <text x={PAD.left - 8} y={y(value) + 4} className="axis-label" textAnchor="end">
              {shortTime(value)}
            </text>
          </g>
        ))}
        {layers.map((layer, index) => {
          const x = PAD.left + index * barW
          const width = Math.max(barW - (barW > 4 ? 1.5 : 0), 0.6)
          const ideal = Math.min(layer.idealSeconds, layer.seconds)
          const extra = Math.max(0, layer.seconds - ideal - layer.coolingSeconds)
          return (
            <g
              key={layer.index}
              onMouseEnter={() => setHover(index)}
              className={`layer-bar ${hover === index ? 'is-hover' : ''}`}
              style={{ '--i': index } as CSSProperties}
            >
              <rect x={x} y={PAD.top} width={barW} height={innerH} className="hit" />
              <rect x={x} y={y(ideal)} width={width} height={y(0) - y(ideal)} className="bar-print" />
              <rect
                x={x}
                y={y(ideal + extra)}
                width={width}
                height={y(ideal) - y(ideal + extra)}
                className="bar-mechanics"
              />
              {layer.coolingSeconds > 0 && (
                <rect
                  x={x}
                  y={y(layer.seconds)}
                  width={width}
                  height={y(ideal + extra) - y(layer.seconds)}
                  className="bar-cooling"
                />
              )}
              {layer.seconds > top && (
                <>
                  <rect x={x} y={PAD.top - 4} width={Math.max(width, 3)} height={3} className="bar-clip" />
                  {clipLabels.has(index) && (
                    <text x={x + Math.max(width, 3) + 4} y={PAD.top + 8} className="clip-label">
                      {shortTime(layer.seconds)}
                    </text>
                  )}
                </>
              )}
              {index % labelEvery === 0 && (
                <text x={x + barW / 2} y={CHART_H - 8} className="axis-label" textAnchor="middle">
                  {index + 1}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      <div className="chart-legend">
        <span><i className="dot tone-print" /> {t.time.legendSpeed}</span>
        <span><i className="dot tone-mechanics" /> {t.time.legendAccel}</span>
        <span><i className="dot tone-cooling" /> {t.time.legendCooling}</span>
        <span className="muted">{t.time.legendLayerAxis}</span>
      </div>
    </div>
  )
}

export function FlowChart({ flow }: { flow: FlowStats }) {
  const { t } = useI18n()
  if (!flow.extrusionSeconds) return null
  const max = Math.max(...flow.bins, 1e-6)
  const span = flow.bins.length * flow.binWidth
  const innerW = CHART_W - PAD.left - PAD.right
  const innerH = CHART_H - PAD.top - PAD.bottom
  const x = (value: number) => PAD.left + (value / span) * innerW
  const barW = innerW / flow.bins.length
  const headroom = flow.p95 > 0 ? flow.limit / flow.p95 : 0
  const tickStep = niceStep(span, 6)
  const unit = t.units.mm3s

  return (
    <div className="chart">
      <div className="chart-stats">
        <span>
          {t.time.flowTypical} <b>{formatNumber(flow.p50, 1)} {unit}</b>
        </span>
        <span>
          {t.time.flowP95} <b>{formatNumber(flow.p95, 1)} {unit}</b>
        </span>
        <span>
          {t.time.flowLimit} <b>{formatNumber(flow.limit, 1)} {unit}</b>
          {headroom > 0 && (
            <>
              {' '}· {t.time.flowHeadroom} <b>×{formatNumber(headroom, 1)}</b>
            </>
          )}
        </span>
        <span>{t.time.flowNearLimit(formatPercent(flow.nearLimitShare * 100))}</span>
      </div>
      <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="chart-svg">
        {Array.from({ length: Math.floor(span / tickStep) + 1 }, (_, tick) => tick * tickStep).map((value) => (
          <text key={value} x={x(value)} y={CHART_H - 8} className="axis-label" textAnchor="middle">
            {formatNumber(value, value % 1 ? 1 : 0)}
          </text>
        ))}
        <line x1={PAD.left} x2={CHART_W - PAD.right} y1={PAD.top + innerH} y2={PAD.top + innerH} className="grid-line" />
        {flow.bins.map((seconds, bin) => {
          const height = (seconds / max) * innerH
          const center = (bin + 0.5) * flow.binWidth
          return (
            <rect
              key={bin}
              x={PAD.left + bin * barW}
              y={PAD.top + innerH - height}
              width={Math.max(barW - 1.5, 0.6)}
              height={height}
              className={center >= flow.limit * 0.9 ? 'bar-hotend' : 'bar-flow'}
            >
              <title>
                {`${formatNumber(bin * flow.binWidth, 1)}–${formatNumber((bin + 1) * flow.binWidth, 1)} ${unit}: ${formatTime(seconds)}`}
              </title>
            </rect>
          )
        })}
        <line x1={x(flow.limit)} x2={x(flow.limit)} y1={PAD.top} y2={PAD.top + innerH} className="limit-line" />
        <text x={x(flow.limit) - 6} y={PAD.top + 12} className="limit-label" textAnchor="end">
          {t.time.flowLimitLabel}
        </text>
        <line x1={x(flow.p95)} x2={x(flow.p95)} y1={PAD.top} y2={PAD.top + innerH} className="p95-line" />
        <text x={x(flow.p95) + 6} y={PAD.top + 12} className="p95-label">
          95%
        </text>
      </svg>
      <div className="chart-legend">
        <span className="muted">{t.time.flowAxis}</span>
      </div>
    </div>
  )
}

export function FileFacts({
  result,
  density,
  diameter,
}: {
  result: AnalysisResult
  density: number | null
  diameter: number
}) {
  const { t } = useI18n()
  const area = Math.PI * (diameter / 2) ** 2
  const grams = density ? (result.filamentLength * area * density) / 1000 : null
  const topZ = result.layers.length ? result.layers[result.layers.length - 1].z : 0
  return (
    <dl className="facts">
      <div>
        <dt>{t.summary.plastic}</dt>
        <dd>
          {formatLength(result.filamentLength)}
          {grams !== null && (
            <small>
              {' '}· ≈{formatNumber(grams)} {t.units.g}
            </small>
          )}
        </dd>
      </div>
      <div>
        <dt>{t.summary.layers}</dt>
        <dd>
          {result.layerCount}
          {topZ > 0 && <small> · {t.summary.upToZ(formatNumber(topZ, 1))}</small>}
        </dd>
      </div>
    </dl>
  )
}
