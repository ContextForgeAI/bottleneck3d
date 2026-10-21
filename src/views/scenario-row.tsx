import { formatNumber, formatPercent, formatTime } from '../format'
import { useI18n } from '../i18n'
import type { Scenario } from '../insights'

export interface ScenarioOutcome {
  seconds: number
  /** Seconds saved against the file; negative when slower. */
  saved: number
  savedShare: number
}

export function ScenarioRow({
  scenario,
  outcome,
  maxSaved,
  base,
  active = false,
  onPick,
}: {
  scenario: Scenario
  outcome: ScenarioOutcome
  maxSaved: number
  base?: { acceleration: number; maxVolumetricFlow: number; maxPrintSpeed: number }
  active?: boolean
  onPick: () => void
}) {
  const { t } = useI18n()
  const p = scenario.profile
  const detail = !base
    ? null
    : scenario.id.startsWith('accel')
      ? t.scenarios.detailAccel(formatNumber(base.acceleration), formatNumber(p.acceleration))
      : scenario.id.startsWith('flow')
        ? t.scenarios.detailFlow(formatNumber(base.maxVolumetricFlow, 1), formatNumber(p.maxVolumetricFlow, 1))
        : scenario.id.startsWith('speed')
          ? t.scenarios.detailSpeed(formatNumber(p.maxPrintSpeed / Math.max(base.maxPrintSpeed, 1), 2))
          : t.scenarios.detailCombo
  const gain = outcome.saved >= 30

  return (
    <button
      type="button"
      className={`scenario ${active ? 'is-active' : ''} ${gain ? '' : 'is-flat'}`}
      onClick={onPick}
    >
      <span className={`scenario-kind kind-${scenario.kind}`}>{t.scenarios.kind[scenario.kind]}</span>
      <span className="scenario-title">
        {t.scenarios.title[scenario.id]}
        {active && <em>{t.scenarios.active}</em>}
      </span>
      {detail && <small className="scenario-detail">{detail}</small>}
      <span className="scenario-bar">
        <i style={{ width: `${Math.max(2, (Math.max(0, outcome.saved) / maxSaved) * 100)}%` }} />
      </span>
      <b className="scenario-gain">
        {gain
          ? t.scenarios.saves(`−${formatTime(outcome.saved)}`, formatPercent(outcome.savedShare, 1))
          : t.scenarios.noGain}
      </b>
    </button>
  )
}
