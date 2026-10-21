import { useState } from 'react'
import { FlowChart, LayerChart, RoleBreakdown } from '../charts'
import type { AnalysisResult } from '../domain/result'
import { formatLength, formatNumber, formatPercent, formatTime, share } from '../format'
import { useI18n } from '../i18n'
import { timeCategories } from '../insights'
import { Kpi, Meter, Segmented } from '../ui'

export function TimeView({
  baseline,
  simulation,
  upgraded,
  accelerations,
}: {
  baseline: AnalysisResult
  simulation: AnalysisResult | null
  upgraded: boolean
  accelerations: number[]
}) {
  const { t } = useI18n()
  const [mode, setMode] = useState<'file' | 'upgrade'>('file')
  const shown = mode === 'upgrade' && upgraded && simulation ? simulation : baseline
  const times = timeCategories(shown)
  const layers = [...shown.layers].sort((a, b) => a.seconds - b.seconds)
  const medianLayer = layers.length ? layers[Math.floor(layers.length / 2)].seconds : 0
  const load = share(shown.flow.p95, shown.flow.limit)

  return (
    <div className="time-view">
      <header className="view-head is-row">
        <h1>
          {t.time.title} · <span className="accent-text">{formatTime(shown.estimatedSeconds)}</span>
        </h1>
        <Segmented
          value={upgraded ? mode : 'file'}
          onChange={setMode}
          options={[
            { value: 'file', label: t.time.asSliced },
            { value: 'upgrade', label: t.time.withUpgrade, disabled: !upgraded },
          ]}
        />
      </header>

      <div className="kpis">
        <Kpi
          label={t.time.kpiLoad}
          value={formatPercent(load)}
          note={t.time.kpiLoadNote(formatNumber(shown.flow.p95, 1), formatNumber(shown.flow.limit, 1))}
          tone="hotend"
        >
          <Meter value={load} tone="hotend" />
        </Kpi>
        <Kpi
          label={t.time.kpiAccel}
          value={
            accelerations.length
              ? `${formatNumber(accelerations[0])}–${formatNumber(accelerations[accelerations.length - 1])}`
              : '—'
          }
          note={`${t.units.mms2} · ${t.time.kpiAccelNote}`}
          tone="mechanics"
        />
        <Kpi
          label={t.time.kpiLayer}
          value={formatTime(medianLayer)}
          note={t.time.kpiLayerNote(shown.layerCount)}
          tone="print"
        />
        <Kpi
          label={t.time.kpiTravel}
          value={formatLength(shown.travelDistance)}
          note={t.time.kpiTravelNote(formatTime(times.travel))}
          tone="travel"
        >
          <Meter value={share(times.travel, shown.estimatedSeconds)} tone="travel" />
        </Kpi>
      </div>

      <div className="time-grid">
        <section className="panel">
          <header className="panel-head">
            <h2>{t.time.roles}</h2>
            <span className="muted">{t.time.rolesHint}</span>
          </header>
          <RoleBreakdown result={shown} />
        </section>
        <section className="panel">
          <header className="panel-head">
            <h2>{t.time.flow}</h2>
            <span className="muted">{t.time.flowHint}</span>
          </header>
          <FlowChart flow={shown.flow} />
        </section>
        <section className="panel is-wide">
          <header className="panel-head">
            <h2>{t.time.layers}</h2>
          </header>
          <LayerChart layers={shown.layers} wide />
        </section>
      </div>
    </div>
  )
}
