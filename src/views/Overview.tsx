import { useState } from 'react'
import { CategoryList, FileFacts, SpeedProfile, Waffle } from '../charts'
import type { AnalysisResult } from '../domain/result'
import { formatPercent, formatTime, share } from '../format'
import { useI18n } from '../i18n'
import { mainLoss, timeCategories, type Category, type Scenario, type ScenarioId } from '../insights'
import type { SlicerComparison } from '../slicer-metadata'
import { AnimatedTime, Spinner } from '../ui'
import { ScenarioRow, type ScenarioOutcome } from './scenario-row'

export function SlicerBadge({ comparison }: { comparison: SlicerComparison | null }) {
  const { t } = useI18n()
  if (!comparison) return <span className="chip chip-muted">{t.summary.noEstimate}</span>
  return (
    <div className="slicer-badge">
      <span className={`chip chip-${comparison.agreement}`}>
        {t.summary.agreement[comparison.agreement]} {t.summary.slicerEstimate} ·{' '}
        {comparison.deltaPercent >= 0 ? '+' : '−'}
        {Math.abs(comparison.deltaPercent).toFixed(1)}%
      </span>
      <span className="muted">
        {comparison.slicer || t.summary.slicer}: {formatTime(comparison.slicerSeconds)}
      </span>
    </div>
  )
}

export function Overview({
  baseline,
  comparison,
  density,
  diameter,
  warnings,
  scenarios,
  outcomes,
  onTry,
  onOpenUpgrades,
}: {
  baseline: AnalysisResult
  comparison: SlicerComparison | null
  density: number | null
  diameter: number
  warnings: string[]
  scenarios: Scenario[]
  outcomes: Partial<Record<ScenarioId, ScenarioOutcome>> | null
  onTry: (category: Category) => void
  onOpenUpgrades: (scenario?: ScenarioId) => void
}) {
  const { t } = useI18n()
  const [hover, setHover] = useState<Category | null>(null)
  const [pinned, setPinned] = useState<Category | null>(null)
  const times = timeCategories(baseline)
  const total = Math.max(baseline.estimatedSeconds, 1e-6)
  const loss = mainLoss(times)
  const slicerBound = share(times.print, total) >= 80
  const focus: Category = hover ?? pinned ?? (slicerBound ? 'print' : loss ?? 'print')
  const verdictKey = slicerBound ? 'slicer' : loss ?? 'none'
  const best = outcomes
    ? scenarios
        .filter((scenario) => scenario.id !== 'combo' && outcomes[scenario.id])
        .sort((a, b) => outcomes[b.id]!.saved - outcomes[a.id]!.saved)
        .slice(0, 3)
    : []
  const maxSaved = Math.max(...best.map((scenario) => outcomes?.[scenario.id]?.saved ?? 0), 1)
  const meaningful = best.some((scenario) => (outcomes?.[scenario.id]?.saved ?? 0) >= 30)

  return (
    <div className="overview">
      <section className="panel ov-time">
        <small className="eyebrow">{t.summary.printTime}</small>
        <strong className="big-time">
          <AnimatedTime seconds={baseline.estimatedSeconds} />
        </strong>
        <SlicerBadge comparison={comparison} />
        <FileFacts result={baseline} density={density} diameter={diameter} />
        {warnings.map((warning) => (
          <div className="callout" key={warning}>
            {warning}
          </div>
        ))}
      </section>

      <section className="panel ov-waffle">
        <header className="panel-head">
          <div>
            <h2>{t.overview.waffleTitle}</h2>
            <p>{t.overview.waffleHint}</p>
          </div>
        </header>
        <div className="waffle-layout">
          <Waffle times={times} active={hover ?? pinned} onActive={setHover} />
          <CategoryList
            times={times}
            active={focus}
            onActive={setHover}
            onPick={(id) => setPinned(pinned === id ? null : id)}
          />
        </div>
      </section>

      <section className={`panel ov-verdict tone-border-${focus}`}>
        <small className="eyebrow">
          {t.categories[focus].label} · {t.overview.share(formatPercent(share(times[focus], total)))}
        </small>
        <h2>{hover || pinned ? t.categories[focus].label : t.overview.verdict[verdictKey]}</h2>
        <p className="lede-sm">
          {!hover && !pinned && slicerBound
            ? t.overview.slicerText(formatPercent(share(times.print, total)))
            : `${t.overview.lossText(formatTime(times[focus]), formatPercent(share(times[focus], total)))} ${t.categories[focus].explain}`}
        </p>
        {focus === 'mechanics' && <SpeedProfile />}
        <div className="improve">
          <small>{t.overview.howToCut}</small>
          <p>{t.categories[focus].improve}</p>
        </div>
        {focus !== 'pauses' && focus !== 'cooling' && (
          <button className="btn" type="button" onClick={() => onTry(focus)}>
            {t.overview.tryIt} →
          </button>
        )}
      </section>

      <section className="panel ov-best">
        <header className="panel-head">
          <div>
            <h2>{t.overview.bestTitle}</h2>
          </div>
          <button className="btn-link" type="button" onClick={() => onOpenUpgrades()}>
            {t.overview.allUpgrades}
          </button>
        </header>
        {!outcomes && (
          <p className="muted with-spinner">
            <Spinner small /> {t.overview.bestComputing}
          </p>
        )}
        {outcomes && (
          <div className="scenario-list">
            {best.map((scenario) => (
              <ScenarioRow
                key={scenario.id}
                scenario={scenario}
                outcome={outcomes[scenario.id]!}
                maxSaved={maxSaved}
                onPick={() => onOpenUpgrades(scenario.id)}
              />
            ))}
            {!meaningful && <p className="muted">{t.overview.bestNone}</p>}
          </div>
        )}
      </section>
    </div>
  )
}
