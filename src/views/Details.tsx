import type { PrinterSettings } from '../domain/profile'
import type { WorkloadMeta } from '../engine'
import { formatNumber, formatTime } from '../format'
import { useI18n } from '../i18n'
import { junctionModelFor } from '../motion-planner'
import type { AppliedSlicerSetting } from '../slicer-metadata'

function NumberField({
  label,
  value,
  unit,
  min,
  max,
  step = 1,
  source,
  onChange,
}: {
  label: string
  value: number
  unit: string
  min: number
  max: number
  step?: number
  source?: string
  onChange: (value: number) => void
}) {
  const { t } = useI18n()
  return (
    <label className="field">
      <span>
        {label}
        {source && <em title={source}>{t.details.fromGcode}</em>}
      </span>
      <div>
        <input
          type="number"
          defaultValue={value}
          key={value}
          min={min}
          max={max}
          step={step}
          onBlur={(event) => {
            const next = Number(event.target.value)
            if (Number.isFinite(next) && next !== value) onChange(next)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
          }}
        />
        <small>{unit}</small>
      </div>
    </label>
  )
}

export function Details({
  meta,
  profile,
  applied,
  onChange,
}: {
  meta: WorkloadMeta
  profile: PrinterSettings
  applied: AppliedSlicerSetting[]
  onChange: (key: keyof PrinterSettings, value: number) => void
}) {
  const { t } = useI18n()
  const keys = new Map(applied.map((item) => [item.field, item.key]))
  return (
    <div className="details-grid">
      <section className="panel">
        <header className="panel-head">
          <div>
            <h2>{t.details.title}</h2>
            <p>{t.details.subtitle}</p>
          </div>
        </header>
        <ul className="method">
          <li>
            {t.details.planner}: <b>{t.details.models[junctionModelFor(meta.slicer.slicer, meta.slicer.config.gcode_flavor)]}</b>
          </li>
          <li>
            {t.details.slicerEstimate}:{' '}
            <b>
              {meta.slicer.estimatedSeconds
                ? `${formatTime(meta.slicer.estimatedSeconds)} (${meta.slicer.estimateSource})`
                : t.details.noEstimate}
            </b>
          </li>
          <li>
            {t.details.accels}:{' '}
            <b>
              {meta.emittedAccelerations.length
                ? `${meta.emittedAccelerations.map((value) => formatNumber(value)).join(', ')} ${t.units.mms2}`
                : t.details.notSet}
            </b>
          </li>
          {keys.has('minimumLayerTime') && <li>{t.details.minLayerNote}</li>}
        </ul>
      </section>
      <section className="panel">
        <header className="panel-head">
          <h2>{t.details.manual}</h2>
        </header>
        <div className="fields">
          <NumberField
            label={t.details.flow}
            value={profile.maxVolumetricFlow}
            unit={t.units.mm3s}
            min={1}
            max={80}
            step={0.5}
            source={keys.get('maxVolumetricFlow')}
            onChange={(value) => onChange('maxVolumetricFlow', value)}
          />
          <NumberField
            label={t.details.maxSpeed}
            value={profile.maxPrintSpeed}
            unit={t.units.mms}
            min={20}
            max={1000}
            source={keys.get('maxPrintSpeed')}
            onChange={(value) => onChange('maxPrintSpeed', value)}
          />
          <NumberField
            label={t.details.accel}
            value={profile.acceleration}
            unit={t.units.mms2}
            min={100}
            max={50000}
            step={100}
            source={keys.get('acceleration')}
            onChange={(value) => onChange('acceleration', value)}
          />
          <NumberField
            label={t.details.minLayer}
            value={profile.minimumLayerTime}
            unit={t.units.s}
            min={0}
            max={60}
            step={0.5}
            source={keys.get('minimumLayerTime')}
            onChange={(value) => onChange('minimumLayerTime', value)}
          />
        </div>
      </section>
    </div>
  )
}
