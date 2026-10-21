import { useMemo, useState } from 'react'
import {
  evaluateWorkload,
  inferTypicalExtrusionSpeed,
  parseGcodeFile,
  parseGcodeText,
} from './analyzer'
import {
  DEFAULT_PRINTER_SETTINGS,
  type PrinterSettings,
} from './domain/profile'
import type { AnalysisResult, BottleneckKind } from './domain/result'
import { simulationModeLabels } from './domain/simulation-mode'
import type { PrintWorkload } from './domain/workload'

type Source =
  | { kind: 'file'; file: File; name: string }
  | { kind: 'text'; text: string; name: string }

const labels: Record<Exclude<BottleneckKind, 'none'>, string> = {
  hotend: 'Хотэнд',
  mechanics: 'Механика',
  cooling: 'Обдув',
}

interface ReportWaterfallItem {
  key: string
  label: string
  source: string
  seconds: number
}

interface BottleneckReport {
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

function demoGcode(): string {
  const lines = ['G21', 'G90', 'M83', 'G92 E0']
  for (let layer = 1; layer <= 30; layer += 1) {
    const z = (layer * 0.2).toFixed(2)
    lines.push(
      `G1 Z${z} F1200`,
      'G1 X20 Y20 F12000',
      'G1 X100 Y20 E5 F12000',
      'G1 X100 Y100 E5',
      'G1 X20 Y100 E5',
      'G1 X20 Y20 E5',
    )
  }
  return lines.join('\n')
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return '—'
  const rounded = Math.round(seconds)
  const hours = Math.floor(rounded / 3600)
  const minutes = Math.floor((rounded % 3600) / 60)
  const rest = rounded % 60
  return hours
    ? `${hours} ч ${minutes} мин`
    : `${minutes} мин ${rest.toString().padStart(2, '0')} с`
}

function diagnosis(result: AnalysisResult): string {
  const lockedShare =
    result.estimatedSeconds > 0
      ? result.idealSeconds / result.estimatedSeconds
      : 0

  if (lockedShare > 0.85 && result.constraintSeconds.hotend < 1) {
    return `Почти всё время — скорости F из слайса (~${Math.round(lockedShare * 100)}%). Главный what-if рычаг здесь — «скорость пути», не хотэнд. Flow поможет только когда путь уже упрётся в мм³/с.`
  }

  if (result.dominant === 'none') {
    return 'При этих лимитах сверху почти ничего не давит — время в основном из геометрии пути и выбранной скорости.'
  }

  const percent = Math.round(result.constraintPercent[result.dominant])
  const explanations: Record<Exclude<BottleneckKind, 'none'>, string> = {
    hotend: `Около ${percent}% лишнего времени — поток пластика. Рычаг: хотэнд/сопло (мм³/с).`,
    mechanics: `Около ${percent}% лишнего — разгон/лимит скорости. Рычаги: скорость пути и accel.`,
    cooling: `Около ${percent}% лишнего — min layer time. Это скорее настройка охлаждения в слайсе, не «деталь с Ali».`,
  }
  return explanations[result.dominant]
}

function formatPercent(value: number): string {
  return `${Math.round(value)}%`
}

function shareOfTotal(part: number, total: number): number {
  if (!total || part <= 0) return 0
  return (part / total) * 100
}

function TimeComposition({
  result,
  title,
}: {
  result: AnalysisResult
  title: string
}) {
  const total = Math.max(result.estimatedSeconds, 1e-6)
  const base = result.idealSeconds
  const extras = {
    mechanics: result.constraintSeconds.mechanics,
    hotend: result.constraintSeconds.hotend,
    cooling: result.constraintSeconds.cooling,
  }
  const extraTotal = extras.mechanics + extras.hotend + extras.cooling
  const baseShare = shareOfTotal(base, total)
  const slices = [
    {
      key: 'base',
      label:
        result.mode === 'virtual_path_retiming'
          ? 'Движение по what-if скорости пути'
          : 'Движение по уже заданным F',
      hint:
        result.mode === 'virtual_path_retiming'
          ? 'база после масштаба F'
          : 'норма печати, не поломка',
      seconds: base,
      tone: 'base' as const,
      actionable: false,
    },
    {
      key: 'mechanics',
      label: 'Разгон/торможение',
      hint: 'рычаг: accel',
      seconds: extras.mechanics,
      tone: 'mechanics' as const,
      actionable: true,
    },
    {
      key: 'hotend',
      label: 'Ожидание flow',
      hint: 'рычаг: хотэнд мм³/с',
      seconds: extras.hotend,
      tone: 'hotend' as const,
      actionable: true,
    },
    {
      key: 'cooling',
      label: 'Паузы min layer time',
      hint: 'рычаг: охлаждение/слайс',
      seconds: extras.cooling,
      tone: 'cooling' as const,
      actionable: true,
    },
  ].filter((slice) => slice.seconds > 0.05 || slice.key === 'base')

  return (
    <div className="time-composition">
      <div className="time-composition-head">
        <div>
          <h3>{title}</h3>
          <p>Зелёное — база. Цветное — добавки, которые what-if может убрать.</p>
        </div>
        <strong>{formatTime(result.estimatedSeconds)}</strong>
      </div>

      <div className="stack-bar" aria-label="Состав времени">
        <i className="base" style={{ width: `${Math.max(baseShare, 0.5)}%` }} />
        <i
          className="mechanics"
          style={{ width: `${shareOfTotal(extras.mechanics, total)}%` }}
        />
        <i
          className="hotend"
          style={{ width: `${shareOfTotal(extras.hotend, total)}%` }}
        />
        <i
          className="cooling"
          style={{ width: `${shareOfTotal(extras.cooling, total)}%` }}
        />
      </div>

      <div className="stack-legend">
        <span>
          <i className="base" /> база {formatPercent(baseShare)}
        </span>
        <span>
          <i className="mechanics" /> разгон{' '}
          {formatPercent(shareOfTotal(extras.mechanics, total))}
        </span>
        <span>
          <i className="hotend" /> flow{' '}
          {formatPercent(shareOfTotal(extras.hotend, total))}
        </span>
        <span>
          <i className="cooling" /> layer{' '}
          {formatPercent(shareOfTotal(extras.cooling, total))}
        </span>
      </div>

      <div className="composition-cards">
        <article className="composition-card is-base">
          <small>База — так и должно быть</small>
          <strong>{formatTime(base)}</strong>
          <p>
            {formatPercent(baseShare)} всего времени. Это сами F из G-code.
            Убрать хотэндом нельзя — только «скорость пути» в what-if или другой
            слайс.
          </p>
        </article>
        <article
          className={`composition-card ${extraTotal > 1 ? 'is-extra' : 'is-quiet'}`}
        >
          <small>Добавки сверх базы</small>
          <strong>{formatTime(extraTotal)}</strong>
          <p>
            {formatPercent(shareOfTotal(extraTotal, total))} всего времени.
            {extraTotal < 60
              ? ' Мало: файл почти не жмёт железо сверху F.'
              : ' Сюда смотри для апгрейда / тюнинга.'}
          </p>
        </article>
      </div>

      <div className="composition-rows">
        {slices.map((slice) => (
          <div
            className={`composition-row ${slice.actionable ? 'is-actionable' : ''}`}
            key={slice.key}
          >
            <div>
              <span>{slice.label}</span>
              <small>{slice.hint}</small>
            </div>
            <div className="composition-row-track">
              <i
                className={slice.tone}
                style={{
                  width: `${Math.max(
                    shareOfTotal(slice.seconds, total),
                    slice.seconds > 0 ? 1.5 : 0,
                  )}%`,
                }}
              />
            </div>
            <b>
              {formatTime(slice.seconds)}
              <em>{formatPercent(shareOfTotal(slice.seconds, total))}</em>
            </b>
          </div>
        ))}
      </div>
    </div>
  )
}

function CompareStrip({
  baselineSeconds,
  simulationSeconds,
}: {
  baselineSeconds: number
  simulationSeconds: number
}) {
  const max = Math.max(baselineSeconds, simulationSeconds, 1)
  const saved = Math.max(0, baselineSeconds - simulationSeconds)
  return (
    <div className="compare-strip">
      <div className="compare-row">
        <span>Как в файле</span>
        <div className="compare-track">
          <i
            className="base"
            style={{ width: `${(baselineSeconds / max) * 100}%` }}
          />
        </div>
        <b>{formatTime(baselineSeconds)}</b>
      </div>
      <div className="compare-row">
        <span>What-if</span>
        <div className="compare-track">
          <i
            className="after"
            style={{ width: `${(simulationSeconds / max) * 100}%` }}
          />
        </div>
        <b>{formatTime(simulationSeconds)}</b>
      </div>
      <div className="compare-saved">
        {saved > 1
          ? `Можно выиграть ~${formatTime(saved)} на этой же траектории`
          : 'Почти без выигрыша: подними «скорость пути», чтобы увидеть эффект без нового слайса'}
      </div>
    </div>
  )
}

function ReportViewer({ report }: { report: BottleneckReport }) {
  const items = report.timeWaterfall?.items ?? []
  const totalSeconds = report.timeWaterfall?.totals?.motionSeconds ?? 0
  const roles = report.roleImpact?.roles ?? []
  const conflicts = report.effectiveProfile?.conflicts ?? []

  return (
    <section className="panel report-viewer">
      <div className="section-heading">
        <div>
          <span className="step">R</span>
          <h2>Report viewer</h2>
        </div>
        <span className="mode-pill">bottleneck3d-report.json</span>
      </div>

      <div className="report-grid">
        <div className="report-card">
          <small>Файл</small>
          <strong>{report.gcode?.fileName ?? 'unknown'}</strong>
          <span>
            {report.gcode?.sizeBytes
              ? `${report.gcode.sizeBytes} байт`
              : 'размер неизвестен'}
          </span>
        </div>
        <div className="report-card">
          <small>Top role</small>
          <strong>{report.roleImpact?.topRole ?? 'unknown'}</strong>
          <span>upgrade relevance</span>
        </div>
        <div className="report-card">
          <small>Conflicts</small>
          <strong>{conflicts.length}</strong>
          <span>profile vs G-code</span>
        </div>
      </div>

      {items.length > 0 && (
        <div className="waterfall report-waterfall">
          <div className="waterfall-heading">
            <h3>Report time waterfall</h3>
            <span>{formatTime(totalSeconds)} motion</span>
          </div>
          {items.map((item) => {
            const width = totalSeconds
              ? item.seconds > 0
                ? Math.max(2, (item.seconds / totalSeconds) * 100)
                : 0
              : 0

            return (
              <div className="waterfall-row" key={item.key}>
                <div>
                  <span>{item.label}</span>
                  <small>{item.source}</small>
                </div>
                <div className="waterfall-track">
                  <i className="base" style={{ width: `${width}%` }} />
                </div>
                <b>{formatTime(item.seconds)}</b>
              </div>
            )
          })}
          {(report.timeWaterfall?.unavailable ?? []).map((item) => (
            <p key={item.key}>{item.reason}</p>
          ))}
        </div>
      )}

      {roles.length > 0 && (
        <div className="role-impact-list">
          {roles.slice(0, 5).map((role) => (
            <div className="role-impact-card" key={role.role}>
              <div>
                <strong>{role.role}</strong>
                <span>{formatTime(role.seconds)} · {formatPercent(role.percent)}</span>
              </div>
              <p>{role.note}</p>
              <small>{role.upgradeLevers.join(' / ')}</small>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

async function loadWorkload(source: Source): Promise<PrintWorkload> {
  return source.kind === 'file'
    ? parseGcodeFile(source.file)
    : parseGcodeText(source.text)
}

interface NumberFieldProps {
  label: string
  value: number
  unit: string
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
}

function NumberField({
  label,
  value,
  unit,
  min,
  max,
  step = 1,
  onChange,
}: NumberFieldProps) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="field-control">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <small>{unit}</small>
      </div>
    </label>
  )
}

function formatDeltaMinutes(seconds: number): string {
  const minutes = seconds / 60
  if (Math.abs(minutes) < 0.08) return '≈0'
  const rounded =
    Math.abs(minutes) >= 10
      ? Math.round(minutes)
      : Math.round(minutes * 10) / 10
  return `${rounded > 0 ? '−' : '+'}${Math.abs(rounded)} мин`
}

type LeverKey =
  | 'maxPrintSpeed'
  | 'maxVolumetricFlow'
  | 'acceleration'
  | 'minimumLayerTime'

function leverHint(
  key: LeverKey,
  deltaSeconds: number,
  virtual: PrinterSettings,
  reference: PrinterSettings,
  typical: number,
): string {
  const idle = Math.abs(deltaSeconds) < 5

  if (key === 'maxPrintSpeed') {
    if (idle) {
      return virtual.maxPrintSpeed <= typical * 1.05
        ? 'как в файле — двигай выше, чтобы увидеть эффект'
        : 'почти без эффекта'
    }
    return `${formatDeltaMinutes(deltaSeconds)} vs скорость файла`
  }

  if (key === 'maxVolumetricFlow') {
    if (idle) {
      return virtual.maxPrintSpeed <= typical * 1.2
        ? 'не жмёт: путь ещё ниже потолка flow'
        : 'потолок выше, чем просит этот путь'
    }
    return virtual.maxVolumetricFlow < reference.maxVolumetricFlow
      ? `${formatDeltaMinutes(deltaSeconds)} (ниже потолка — медленнее)`
      : `${formatDeltaMinutes(deltaSeconds)} за счёт flow`
  }

  if (key === 'acceleration') {
    if (idle) {
      return 'мало коротких сегментов / accel уже хватает'
    }
    return `${formatDeltaMinutes(deltaSeconds)} на разгоне`
  }

  if (idle) {
    return virtual.minimumLayerTime <= reference.minimumLayerTime
      ? 'слои уже длиннее min layer time'
      : 'добавляет паузы охлаждения'
  }
  return `${formatDeltaMinutes(deltaSeconds)} пауз слоёв`
}

export default function App() {
  const [currentProfile, setCurrentProfile] =
    useState<PrinterSettings>(DEFAULT_PRINTER_SETTINGS)
  const [virtualProfile, setVirtualProfile] =
    useState<PrinterSettings>(DEFAULT_PRINTER_SETTINGS)
  const [fileTypicalSpeed, setFileTypicalSpeed] = useState(50)
  const [source, setSource] = useState<Source | null>(null)
  const [workload, setWorkload] = useState<PrintWorkload | null>(null)
  const [baseline, setBaseline] = useState<AnalysisResult | null>(null)
  const [simulation, setSimulation] = useState<AnalysisResult | null>(null)
  const [report, setReport] = useState<BottleneckReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const savedSeconds = useMemo(() => {
    if (!baseline || !simulation) return 0
    return Math.max(0, baseline.estimatedSeconds - simulation.estimatedSeconds)
  }, [baseline, simulation])

  const referenceVirtual = useMemo(
    () => ({
      ...currentProfile,
      maxPrintSpeed: Math.round(fileTypicalSpeed),
    }),
    [currentProfile, fileTypicalSpeed],
  )

  const leverHints = useMemo(() => {
    if (!workload || !simulation) {
      return null
    }

    const currentSeconds = simulation.estimatedSeconds
    const keys: LeverKey[] = [
      'maxPrintSpeed',
      'maxVolumetricFlow',
      'acceleration',
      'minimumLayerTime',
    ]
    const hints = {} as Record<
      LeverKey,
      { deltaSeconds: number; text: string; live: boolean }
    >

    for (const key of keys) {
      const reverted = {
        ...virtualProfile,
        [key]: referenceVirtual[key],
      }
      const without = evaluateWorkload(
        workload,
        reverted,
        'virtual_limits',
        fileTypicalSpeed,
      )
      const deltaSeconds = without.estimatedSeconds - currentSeconds
      hints[key] = {
        deltaSeconds,
        live: Math.abs(deltaSeconds) >= 5,
        text: leverHint(
          key,
          deltaSeconds,
          virtualProfile,
          referenceVirtual,
          fileTypicalSpeed,
        ),
      }
    }

    return hints
  }, [
    workload,
    simulation,
    virtualProfile,
    referenceVirtual,
    fileTypicalSpeed,
  ])

  function updateCurrent(key: keyof PrinterSettings, value: number) {
    setCurrentProfile((profile) => ({ ...profile, [key]: value }))
  }

  function evaluateVirtual(
    nextWorkload: PrintWorkload,
    nextVirtual: PrinterSettings,
    typicalSpeed: number,
  ) {
    return evaluateWorkload(
      nextWorkload,
      nextVirtual,
      'virtual_limits',
      typicalSpeed,
    )
  }

  async function loadSource(nextSource: Source) {
    setBusy(true)
    setError('')
    try {
      const nextWorkload = await loadWorkload(nextSource)
      const typical = inferTypicalExtrusionSpeed(nextWorkload)
      const pathProfile = {
        ...currentProfile,
        maxPrintSpeed: Math.round(typical),
      }
      const base = evaluateWorkload(nextWorkload, currentProfile, 'as_emitted')
      const virtual = evaluateVirtual(nextWorkload, pathProfile, typical)
      setSource(nextSource)
      setWorkload(nextWorkload)
      setFileTypicalSpeed(typical)
      setBaseline(base)
      setSimulation(virtual)
      setReport(null)
      setVirtualProfile(pathProfile)
    } catch {
      setError('Не удалось разобрать файл. Убедитесь, что это текстовый G-code.')
    } finally {
      setBusy(false)
    }
  }

  async function loadReportFile(file: File) {
    setBusy(true)
    setError('')
    try {
      const parsed = JSON.parse(await file.text()) as BottleneckReport
      setReport(parsed)
      setSource({ kind: 'file', file, name: file.name })
      setWorkload(null)
      setBaseline(null)
      setSimulation(null)
    } catch {
      setError('Не удалось прочитать report JSON.')
    } finally {
      setBusy(false)
    }
  }

  function updateVirtual(key: keyof PrinterSettings, value: number) {
    if (!workload) return
    const nextProfile = { ...virtualProfile, [key]: value }
    setVirtualProfile(nextProfile)
    setSimulation(evaluateVirtual(workload, nextProfile, fileTypicalSpeed))
  }

  function resetSimulation() {
    if (!workload) return
    const pathProfile = {
      ...currentProfile,
      maxPrintSpeed: Math.round(fileTypicalSpeed),
    }
    setVirtualProfile(pathProfile)
    setSimulation(evaluateVirtual(workload, pathProfile, fileTypicalSpeed))
  }

  return (
    <main>
      <header className="hero">
        <div className="brand">Bottleneck<span>3D</span></div>
        <p className="eyebrow">Виртуальный тест-драйв апгрейдов</p>
        <h1>Узнайте, что действительно тормозит вашу печать</h1>
        <p className="lede">
          G-code анализируется прямо в браузере. Файл никуда не отправляется.
        </p>
      </header>

      <section className="panel setup">
        <div className="section-heading">
          <div>
            <span className="step">01</span>
            <h2>Текущий принтер</h2>
          </div>
          <p>Пока это ручные override для audit готового G-code.</p>
        </div>
        <div className="fields">
          <NumberField
            label="Макс. объёмный поток"
            value={currentProfile.maxVolumetricFlow}
            unit="мм³/с"
            min={1}
            max={80}
            step={0.5}
            onChange={(value) => updateCurrent('maxVolumetricFlow', value)}
          />
          <NumberField
            label="Макс. скорость печати"
            value={currentProfile.maxPrintSpeed}
            unit="мм/с"
            min={20}
            max={1000}
            onChange={(value) => updateCurrent('maxPrintSpeed', value)}
          />
          <NumberField
            label="Ускорение"
            value={currentProfile.acceleration}
            unit="мм/с²"
            min={100}
            max={50000}
            step={100}
            onChange={(value) => updateCurrent('acceleration', value)}
          />
          <NumberField
            label="Мин. время слоя"
            value={currentProfile.minimumLayerTime}
            unit="с"
            min={0}
            max={60}
            step={0.5}
            onChange={(value) => updateCurrent('minimumLayerTime', value)}
          />
        </div>

        <div className="upload">
          <label className="upload-button">
            <input
              type="file"
              accept=".gcode,.gco,.gc,.json,application/json"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (!file) return
                if (file.name.toLowerCase().endsWith('.json')) {
                  void loadReportFile(file)
                  return
                }
                void loadSource({ kind: 'file', file, name: file.name })
              }}
            />
            {busy ? 'Анализируем…' : 'Выбрать G-code / report'}
          </label>
          <button
            className="text-button"
            type="button"
            onClick={() =>
              void loadSource({
                kind: 'text',
                text: demoGcode(),
                name: 'Демонстрационная деталь',
              })
            }
          >
            Запустить демо
          </button>
          {source && <span className="filename">{source.name}</span>}
          {error && <span className="error">{error}</span>}
        </div>
      </section>

      {baseline && simulation && (
        <>
          <section className="panel result">
            <div className="section-heading">
              <div>
                <span className="step">02</span>
                <h2>Диагноз</h2>
              </div>
              <div className="badges">
                <span className="mode-pill">
                  {simulationModeLabels[baseline.mode]}
                </span>
                <span
                  className={`badge ${
                    baseline.idealSeconds / baseline.estimatedSeconds > 0.85
                      ? 'mechanics'
                      : baseline.dominant
                  }`}
                >
                  {baseline.idealSeconds / baseline.estimatedSeconds > 0.85
                    ? 'Время задают F слайса'
                    : baseline.dominant === 'none'
                      ? 'Явного узкого места нет'
                      : `Добавка: ${labels[baseline.dominant]}`}
                </span>
              </div>
            </div>
            <div className="diagnosis">
              <div>
                <small>Расчётное время</small>
                <strong>{formatTime(baseline.estimatedSeconds)}</strong>
                <span>
                  {baseline.layerCount} слоёв · {baseline.moveCount} перемещений
                  · уверенность {baseline.confidence}
                </span>
              </div>
              <p>{diagnosis(baseline)}</p>
            </div>
            <TimeComposition result={baseline} title="Состав времени" />
            <CompareStrip
              baselineSeconds={baseline.estimatedSeconds}
              simulationSeconds={simulation.estimatedSeconds}
            />
            {baseline.warnings.map((warning) => (
              <p className="warning" key={warning}>{warning}</p>
            ))}
          </section>

          <section className="panel simulator">
            <div className="section-heading">
              <div>
                <span className="step">03</span>
                <h2>What-if: та же траектория</h2>
              </div>
              <button className="text-button" type="button" onClick={() => resetSimulation()}>
                Сбросить
              </button>
            </div>
            <p className="mode-note">
              На медленном слайсе почти всё время — F в файле. Тогда «скорость
              пути» — главный рычаг. Flow и accel начинают менять итог, когда
              путь уже быстрый и упирается в мм³/с или короткие сегменты. У
              каждого слайдера — живой вклад на <b>этом</b> G-code.
            </p>
            <div className="sliders">
              <label>
                <span>
                  Скорость пути <b>{virtualProfile.maxPrintSpeed} мм/с</b>
                  <small>
                    в файле типично ~{Math.round(fileTypicalSpeed)} мм/с
                    {leverHints ? (
                      <em className={leverHints.maxPrintSpeed.live ? 'live' : 'idle'}>
                        {leverHints.maxPrintSpeed.text}
                      </em>
                    ) : null}
                  </small>
                </span>
                <input
                  type="range"
                  min="20"
                  max="500"
                  step="5"
                  value={virtualProfile.maxPrintSpeed}
                  onChange={(event) =>
                    updateVirtual('maxPrintSpeed', Number(event.target.value))
                  }
                />
              </label>
              <label>
                <span>
                  Потолок flow <b>{virtualProfile.maxVolumetricFlow} мм³/с</b>
                  <small>
                    {leverHints ? (
                      <em className={leverHints.maxVolumetricFlow.live ? 'live' : 'idle'}>
                        {leverHints.maxVolumetricFlow.text}
                      </em>
                    ) : (
                      'потолок пластика'
                    )}
                  </small>
                </span>
                <input
                  type="range"
                  min="1"
                  max="80"
                  step="0.5"
                  value={virtualProfile.maxVolumetricFlow}
                  onChange={(event) =>
                    updateVirtual(
                      'maxVolumetricFlow',
                      Number(event.target.value),
                    )
                  }
                />
              </label>
              <label>
                <span>
                  Ускорение <b>{virtualProfile.acceleration} мм/с²</b>
                  <small>
                    {leverHints ? (
                      <em className={leverHints.acceleration.live ? 'live' : 'idle'}>
                        {leverHints.acceleration.text}
                      </em>
                    ) : (
                      'короткие сегменты'
                    )}
                  </small>
                </span>
                <input
                  type="range"
                  min="100"
                  max="50000"
                  step="100"
                  value={virtualProfile.acceleration}
                  onChange={(event) =>
                    updateVirtual('acceleration', Number(event.target.value))
                  }
                />
              </label>
              <label>
                <span>
                  Min layer time <b>{virtualProfile.minimumLayerTime} с</b>
                  <small>
                    слайс/обдув, не «купи деталь»
                    {leverHints ? (
                      <em className={leverHints.minimumLayerTime.live ? 'live' : 'idle'}>
                        {leverHints.minimumLayerTime.text}
                      </em>
                    ) : null}
                  </small>
                </span>
                <input
                  type="range"
                  min="0"
                  max="30"
                  step="0.5"
                  value={virtualProfile.minimumLayerTime}
                  onChange={(event) =>
                    updateVirtual(
                      'minimumLayerTime',
                      Number(event.target.value),
                    )
                  }
                />
              </label>
            </div>
            {simulation && (
              <TimeComposition
                result={simulation}
                title="What-if: из чего сложилось время"
              />
            )}
            <div className="time-comparison">
              <div>
                <small>Сейчас (как в файле)</small>
                <span>{formatTime(baseline.estimatedSeconds)}</span>
              </div>
              <div className="arrow">→</div>
              <div className="after">
                <small>С новыми лимитами</small>
                <strong>{formatTime(simulation.estimatedSeconds)}</strong>
              </div>
              <div className="saved">
                <small>Разница</small>
                <b>{formatTime(savedSeconds)}</b>
              </div>
            </div>
            {simulation.mode === 'virtual_path_retiming' && (
              <p className="mode-note">
                What-if: {simulationModeLabels[simulation.mode]} · узкое место{' '}
                {simulation.dominant === 'none'
                  ? 'не выделено'
                  : labels[simulation.dominant]}
                {virtualProfile.maxPrintSpeed > fileTypicalSpeed * 2
                  ? ` · это кинематическая фантазия (×${(
                      virtualProfile.maxPrintSpeed / Math.max(fileTypicalSpeed, 1)
                    ).toFixed(0)} к F файла), не прогноз магазинного апгрейда`
                  : ''}
              </p>
            )}
          </section>
        </>
      )}

      {report && <ReportViewer report={report} />}

      <footer>
        Локальный прототип · Оценка пока не заменяет проверку на реальном принтере
      </footer>
    </main>
  )
}
