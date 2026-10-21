import type { ReactNode } from 'react'
import { CategoryBar, CategoryList } from '../charts'
import type { TimeConfidence } from '../confidence'
import type { PrinterSettings } from '../domain/profile'
import type { AnalysisResult } from '../domain/result'
import { formatDelta, formatNumber, formatPercent, formatTime, share } from '../format'
import { useI18n } from '../i18n'
import { LEVERS, timeCategories, type LeverKey, type Scenario, type ScenarioId } from '../insights'
import { AnimatedTime, Lever, Spinner } from '../ui'
import { ConfidenceBadge } from './Overview'
import { ScenarioRow, type ScenarioOutcome } from './scenario-row'

export interface ReslicePanel {
  available: boolean
  canRun: boolean
  busy: boolean
  elapsedSec: number
  stale: boolean
  error: string
  orcaDelta: number | null
  onRun: () => void
}

export function Upgrades({
  baseline,
  confidence,
  simulation,
  computing,
  scenarios,
  outcomes,
  activeScenario,
  reference,
  virtual,
  typicalSpeed,
  effects,
  presets,
  onScenario,
  onLever,
  onReset,
  reslice,
}: {
  baseline: AnalysisResult
  confidence?: TimeConfidence | null
  simulation: AnalysisResult | null
  computing: boolean
  scenarios: Scenario[]
  outcomes: Partial<Record<ScenarioId, ScenarioOutcome>> | null
  activeScenario: ScenarioId | null
  reference: PrinterSettings
  virtual: PrinterSettings
  typicalSpeed: number
  effects: Partial<Record<LeverKey, number>> | null
  presets: ReactNode
  onScenario: (id: ScenarioId) => void
  onLever: (key: LeverKey, value: number) => void
  onReset: () => void
  reslice?: ReslicePanel | null
}) {
  const { t } = useI18n()
  const sorted = outcomes
    ? [...scenarios].sort((a, b) => (outcomes[b.id]?.saved ?? 0) - (outcomes[a.id]?.saved ?? 0))
    : scenarios
  const maxSaved = Math.max(...scenarios.map((scenario) => outcomes?.[scenario.id]?.saved ?? 0), 1)
  const useful = sorted.filter((scenario) => (outcomes?.[scenario.id]?.saved ?? 0) >= 30)
  const useless = sorted.filter((scenario) => (outcomes?.[scenario.id]?.saved ?? 0) < 30)
  const row = (scenario: Scenario) => (
    <ScenarioRow
      key={scenario.id}
      scenario={scenario}
      outcome={outcomes![scenario.id]!}
      maxSaved={maxSaved}
      base={reference}
      active={activeScenario === scenario.id}
      onPick={() => onScenario(scenario.id)}
    />
  )
  const before = timeCategories(baseline)
  const after = simulation ? timeCategories(simulation) : before
  const afterSeconds = simulation?.estimatedSeconds ?? baseline.estimatedSeconds
  const delta = afterSeconds - baseline.estimatedSeconds
  const scale = Math.max(baseline.estimatedSeconds, afterSeconds)
  const speedFactor = virtual.maxPrintSpeed / Math.max(typicalSpeed, 1)
  const units: Record<LeverKey, string> = {
    maxPrintSpeed: t.units.mms,
    acceleration: t.units.mms2,
    maxVolumetricFlow: t.units.mm3s,
    minimumLayerTime: t.units.s,
  }
  const notes: Record<LeverKey, string> = {
    maxPrintSpeed: t.upgrades.speedNote(formatNumber(speedFactor, 2)),
    acceleration: t.upgrades.accelNote,
    maxVolumetricFlow: t.upgrades.flowNote,
    minimumLayerTime: t.upgrades.coolingNote,
  }

  return (
    <div className="upgrades">
      <header className="view-head">
        <h1>{t.upgrades.title}</h1>
        <p className="view-sub">{t.upgrades.lede}</p>
      </header>

      <div className="upgrades-grid">
        <section className="panel">
          <header className="panel-head">
            <div>
              <h2>{t.upgrades.ready}</h2>
              <p>{t.upgrades.readyHint}</p>
            </div>
          </header>
          {!outcomes && (
            <p className="muted with-spinner">
              <Spinner small /> {t.overview.bestComputing}
            </p>
          )}
          <div className="scenario-list">
            {outcomes && useful.map(row)}
            {outcomes && useless.length > 0 && (
              <details className="scenario-more" open={useless.some((scenario) => scenario.id === activeScenario)}>
                <summary>{t.upgrades.useless(useless.length)}</summary>
                <div className="scenario-list">{useless.map(row)}</div>
              </details>
            )}
          </div>
        </section>

        <section className="panel">
          <header className="panel-head">
            <div>
              <h2>{t.upgrades.manual}</h2>
              <p>{t.upgrades.manualHint}</p>
            </div>
          </header>
          <div className="levers">
            {LEVERS.map((lever) => {
              const changed = virtual[lever.key] !== reference[lever.key]
              const effect = effects?.[lever.key]
              return (
                <Lever
                  key={lever.key}
                  label={t.upgrades.levers[lever.key]}
                  note={notes[lever.key]}
                  unit={units[lever.key]}
                  value={virtual[lever.key]}
                  min={lever.min}
                  max={lever.max}
                  step={lever.step}
                  digits={lever.digits}
                  changed={changed}
                  onCommit={(value) => onLever(lever.key, value)}
                  footer={
                    <>
                      <button
                        type="button"
                        className="btn-link"
                        disabled={!changed}
                        title={t.upgrades.resetLever}
                        onClick={() => onLever(lever.key, reference[lever.key])}
                      >
                        {t.upgrades.inFile(
                          `${formatNumber(reference[lever.key], lever.digits)} ${units[lever.key]}`,
                        )}
                      </button>
                      {changed &&
                        (effect === undefined ? (
                          <Spinner small />
                        ) : Math.abs(effect) >= 5 ? (
                          <span className={`effect ${effect > 0 ? 'is-good' : 'is-bad'}`}>
                            {effect > 0 ? '−' : '+'}
                            {formatTime(effect)}
                          </span>
                        ) : (
                          <span className="effect">{t.upgrades.noEffect}</span>
                        ))}
                    </>
                  }
                />
              )
            })}
          </div>
          {presets}
        </section>

        <aside className={`panel result-card ${computing ? 'is-computing' : ''}`}>
          <header className="panel-head">
            <div>
              <h2>{t.upgrades.result}</h2>
            </div>
            {computing && (
              <span className="computing-pill">
                <Spinner small /> {t.activity.computing}
              </span>
            )}
          </header>
          <div className="result-times">
            <div>
              <span>{t.upgrades.now}</span>
              <b>{formatTime(baseline.estimatedSeconds)}</b>
            </div>
            <span className="arrow">→</span>
            <div>
              <span>{t.upgrades.after}</span>
              <b className="is-accent">
                <AnimatedTime seconds={afterSeconds} />
              </b>
            </div>
          </div>
          <div className="confidence-inline">
            {confidence && <ConfidenceBadge value={confidence} compact />}
            <span className="muted">
              {reslice?.available ? t.summary.forecastReslice : t.summary.forecast}
            </span>
          </div>
          <div className={`result-delta ${delta <= -1 ? 'is-good' : delta >= 1 ? 'is-bad' : ''}`}>
            <strong>
              <AnimatedTime seconds={delta} format={formatDelta} />
            </strong>
            <span>
              {Math.abs(delta) < 1
                ? t.upgrades.same
                : (delta < 0 ? t.upgrades.faster : t.upgrades.slower)(
                    formatPercent(share(Math.abs(delta), baseline.estimatedSeconds), 1),
                  )}
            </span>
          </div>
          <div className="compare-bars">
            <div>
              <span>{t.upgrades.before}</span>
              <CategoryBar times={before} scaleTo={scale} />
            </div>
            <div>
              <span>{t.upgrades.became}</span>
              <CategoryBar times={after} scaleTo={scale} />
            </div>
          </div>
          {Math.abs(delta) >= 1 ? (
            <>
              <small className="eyebrow">{t.upgrades.why}</small>
              <CategoryList times={after} compareTo={before} />
            </>
          ) : (
            <p className="muted">{t.upgrades.nothingYet}</p>
          )}
          {(simulation?.envelopeBreaches ?? []).map((breach) => (
            <p className="callout" key={breach.limit}>
              {breach.limit === 'machine_max_acceleration'
                ? t.upgrades.envelopeAccel(formatNumber(breach.from), formatNumber(breach.to))
                : t.upgrades.envelopeSpeed(formatNumber(breach.from), formatNumber(breach.to))}
            </p>
          ))}
          {speedFactor > 2 && <p className="callout">{t.upgrades.fantasy(formatNumber(speedFactor, 1))}</p>}
          {reslice?.available && (
            <div className={`reslice ${reslice.busy ? 'is-busy' : ''} ${reslice.stale ? 'is-stale' : ''}`}>
              {reslice.busy ? (
                <p className="with-spinner">
                  <Spinner small /> {t.upgrades.resliceBusy(String(reslice.elapsedSec))}
                </p>
              ) : (
                <button
                  className="btn"
                  type="button"
                  disabled={!reslice.canRun}
                  title={reslice.canRun ? t.upgrades.resliceExact : t.upgrades.resliceNeedChanges}
                  onClick={reslice.onRun}
                >
                  {t.upgrades.reslice}
                </button>
              )}
              {reslice.orcaDelta !== null && !reslice.busy && (
                <p className={`reslice-delta ${reslice.orcaDelta <= -1 ? 'is-good' : reslice.orcaDelta >= 1 ? 'is-bad' : ''}`}>
                  <strong>Orca: {formatDelta(reslice.orcaDelta)}</strong>
                  <span>
                    {t.upgrades.resliceExact}
                    {reslice.stale ? ` · ${t.upgrades.resliceStale}` : ''}
                  </span>
                </p>
              )}
              {!reslice.busy &&
                reslice.orcaDelta !== null &&
                !reslice.stale &&
                Math.abs(reslice.orcaDelta - delta) > Math.max(15, 0.25 * Math.abs(reslice.orcaDelta)) && (
                  <p className="muted">{t.upgrades.resliceMismatch}</p>
                )}
              {reslice.error && !reslice.busy && <p className="callout">{t.upgrades.resliceError(reslice.error)}</p>}
            </div>
          )}
          <button className="btn btn-ghost" type="button" onClick={onReset} disabled={Math.abs(delta) < 1}>
            {t.upgrades.reset}
          </button>
        </aside>
      </div>
    </div>
  )
}
