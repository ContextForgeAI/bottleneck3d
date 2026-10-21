import { formatPercent, formatTime, share } from './format'
import { useI18n } from './i18n'

interface ReportWaterfallItem {
  key: string
  label: string
  source: string
  seconds: number
}

export interface BottleneckReport {
  gcode?: {
    fileName?: string
    sizeBytes?: number | null
  }
  timeWaterfall?: {
    mode?: string
    confidence?: string
    items?: ReportWaterfallItem[]
    totals?: {
      motionSeconds?: number
      extrusionSeconds?: number
      travelSeconds?: number
    }
    unavailable?: Array<{ key: string; reason: string }>
  } | null
  roleImpact?: {
    topRole?: string | null
    roles?: Array<{
      role: string
      seconds: number
      percent: number
      upgradeLevers: string[]
      note: string
    }>
  } | null
  effectiveProfile?: {
    conflicts?: Array<{
      effectiveKey: string
      profileKey: string
      profileValue: unknown
      gcodeValue: unknown
      resolution: string
    }>
  } | null
}

export function ReportViewer({ report }: { report: BottleneckReport }) {
  const { t } = useI18n()
  const items = report.timeWaterfall?.items ?? []
  const totalSeconds = report.timeWaterfall?.totals?.motionSeconds ?? 0
  const roles = report.roleImpact?.roles ?? []
  const conflicts = report.effectiveProfile?.conflicts ?? []

  return (
    <section className="panel">
      <header className="panel-head">
        <div>
          <h2>{t.report.title}</h2>
          <p>{t.report.subtitle}</p>
        </div>
      </header>

      <div className="kpis">
        <article className="kpi">
          <small>{t.report.file}</small>
          <strong className="ellipsis">{report.gcode?.fileName ?? t.report.unknown}</strong>
          <span>
            {report.gcode?.sizeBytes
              ? t.report.size(Math.round(report.gcode.sizeBytes / 1024))
              : t.report.unknownSize}
          </span>
        </article>
        <article className="kpi">
          <small>{t.report.topRole}</small>
          <strong>{report.roleImpact?.topRole ?? '—'}</strong>
          <span>{t.report.byContribution}</span>
        </article>
        <article className="kpi">
          <small>{t.report.conflicts}</small>
          <strong>{conflicts.length}</strong>
          <span>{t.report.profileVsGcode}</span>
        </article>
      </div>

      {items.length > 0 && (
        <div className="card">
          <h3>{t.report.breakdown(formatTime(totalSeconds))}</h3>
          <ul className="breakdown-list">
            {items.map((item) => (
              <li key={item.key}>
                <i className="dot tone-print" />
                <div>
                  <span>{item.label}</span>
                  <small>{item.source}</small>
                </div>
                <b>{formatTime(item.seconds)}</b>
                <em>{formatPercent(share(item.seconds, totalSeconds))}</em>
              </li>
            ))}
          </ul>
          {(report.timeWaterfall?.unavailable ?? []).map((item) => (
            <p className="muted" key={item.key}>{item.reason}</p>
          ))}
        </div>
      )}

      {roles.length > 0 && (
        <div className="card">
          <h3>{t.report.roles}</h3>
          <ul className="breakdown-list">
            {roles.slice(0, 6).map((role) => (
              <li key={role.role}>
                <i className="dot tone-mechanics" />
                <div>
                  <span>{role.role}</span>
                  <small>{role.note} · {role.upgradeLevers.join(' / ')}</small>
                </div>
                <b>{formatTime(role.seconds)}</b>
                <em>{formatPercent(role.percent)}</em>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
