import {
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type DragEvent,
  type ReactNode,
} from 'react'
import { timeConfidenceFromMetadata } from './confidence'
import { DEFAULT_PRINTER_SETTINGS, type PrinterSettings } from './domain/profile'
import type { AnalysisResult, AnalysisWarning } from './domain/result'
import { createEngine, type EvalJob, type WorkloadMeta } from './engine'
import { formatNumber, formatPercent } from './format'
import { useI18n, type Dict } from './i18n'
import {
  buildScenarios,
  LEVERS,
  sameProfile,
  type Category,
  type LeverKey,
  type ScenarioId,
} from './insights'
import {
  connectOrca,
  isInsideOrca,
  resliceChangesFromProfiles,
  resliceChangesKey,
  type OrcaBridge,
  type OrcaStatus,
  type ResliceResult,
} from './orca-bridge'
import { OrcaPresetPanel } from './OrcaPresetPanel'
import {
  buildOrcaPresetLibrary,
  NO_PRESETS,
  resolvePresetSelection,
  type OrcaPresetLibrary,
  type PresetSelection,
  type ResolvedPreset,
} from './orca-presets'
import { ReportViewer, type BottleneckReport } from './ReportViewer'
import {
  firstNonNegativeNumber,
  firstPositiveNumber,
  settingsFromSlicerMetadata,
  slicerMinimumLayerTime,
  type AppliedSlicerSetting,
} from './slicer-metadata'
import { Segmented, Spinner } from './ui'
import { Details } from './views/Details'
import { Overview } from './views/Overview'
import type { ScenarioOutcome } from './views/scenario-row'
import { TimeView } from './views/TimeView'
import { Upgrades } from './views/Upgrades'

type Source =
  | { kind: 'file'; file: File; name: string }
  | { kind: 'text'; text: string; name: string; origin?: 'orca' }

type Tab = 'overview' | 'time' | 'upgrades' | 'details'

/** Orca slices into temp files like ".5760.0.gcode" — not a name a person recognises. */
function isTempName(name: string): boolean {
  return /^\.?\d+(\.\d+)*\.gcode$/i.test(name)
}

function sourceBytes(source: Source): number {
  return source.kind === 'file' ? source.file.size : source.text.length
}

function demoGcode(): string {
  const lines = ['G21', 'G90', 'M83', 'G92 E0']
  for (let layer = 1; layer <= 30; layer += 1) {
    const z = (layer * 0.2).toFixed(2)
    lines.push(
      `G1 Z${z} F1200`,
      'G1 X20 Y20 F12000',
      ';TYPE:Outer wall',
      'G1 X100 Y20 E5 F12000',
      'G1 X100 Y100 E5',
      ';TYPE:Sparse infill',
      'G1 X20 Y100 E5',
      'G1 X20 Y20 E5',
    )
  }
  return lines.join('\n')
}

const PRESET_FOLDER_FILE =
  /((^|\/)(machine|filament|process)\/[^/]+|(^|\/)bottleneck3d-presets[^/]*)\.json$/i

/** Filament preset sets flow, diameter and layer cooling; without one, the file values come back. */
function profileWithFilament(
  profile: PrinterSettings,
  fromFile: PrinterSettings,
  filament: ResolvedPreset | null,
  fileLayerTime?: number | null,
): PrinterSettings {
  const config = filament?.config ?? {}
  return {
    ...profile,
    maxVolumetricFlow:
      firstPositiveNumber(config.filament_max_volumetric_speed) ?? fromFile.maxVolumetricFlow,
    filamentDiameter: firstPositiveNumber(config.filament_diameter) ?? fromFile.filamentDiameter,
    minimumLayerTime:
      firstNonNegativeNumber(config.slow_down_layer_time) ??
      firstNonNegativeNumber(config.slowdown_below_layer_time) ??
      fileLayerTime ??
      fromFile.minimumLayerTime,
  }
}

function warningText(warning: AnalysisWarning, t: Dict): string {
  if (warning.code === 'imperial') return t.warnings.imperial
  return t.warnings.noExtrusion
}

function FilePicker({
  className,
  children,
  onFile,
}: {
  className: string
  children: ReactNode
  onFile: (file: File) => void
}) {
  return (
    <label className={className}>
      <input
        type="file"
        accept=".gcode,.gco,.gc,.g,.json,application/json"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) onFile(file)
          event.target.value = ''
        }}
      />
      {children}
    </label>
  )
}

/** Result tagged with the inputs it was computed for, so stale ones show as pending. */
interface Tagged<T> {
  key: string
  value: T
}

export default function App() {
  const { t, lang, setLang } = useI18n()
  const [engine] = useState(createEngine)
  const activity = useSyncExternalStore(engine.subscribe, engine.activity)

  const [source, setSource] = useState<Source | null>(null)
  const [meta, setMeta] = useState<WorkloadMeta | null>(null)
  const [generation, setGeneration] = useState(0)
  const [typicalSpeed, setTypicalSpeed] = useState(50)
  const [currentProfile, setCurrentProfile] = useState<PrinterSettings>(DEFAULT_PRINTER_SETTINGS)
  const [virtualProfile, setVirtualProfile] = useState<PrinterSettings>(DEFAULT_PRINTER_SETTINGS)
  const [fromFile, setFromFile] = useState<AppliedSlicerSetting[]>([])
  const [baseline, setBaseline] = useState<Tagged<AnalysisResult> | null>(null)
  const [simulation, setSimulation] = useState<Tagged<AnalysisResult> | null>(null)
  const [effects, setEffects] = useState<Tagged<Partial<Record<LeverKey, number>>> | null>(null)
  const [scenarioRuns, setScenarioRuns] = useState<Tagged<AnalysisResult[]> | null>(null)
  const [report, setReport] = useState<BottleneckReport | null>(null)
  const [tab, setTab] = useState<Tab>('overview')
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const [presetLibrary, setPresetLibrary] = useState<OrcaPresetLibrary | null>(null)
  const [presetSelection, setPresetSelection] = useState<PresetSelection>(NO_PRESETS)
  const [presetBusy, setPresetBusy] = useState(false)
  const [orcaStatus, setOrcaStatus] = useState<OrcaStatus | null>(null)
  const [orcaLoadedAt, setOrcaLoadedAt] = useState(0)
  const [resliceState, setResliceState] = useState<
    | { status: 'idle' }
    | { status: 'running'; key: string; started: number }
    | { status: 'done'; key: string; result: ResliceResult }
    | { status: 'error'; key: string; message: string }
  >({ status: 'idle' })
  const [resliceNow, setResliceNow] = useState(0)
  const orcaBridge = useRef<OrcaBridge | null>(null)
  const orcaRequested = useRef({ gcode: false, presets: false })
  const insideOrca = useMemo(isInsideOrca, [])

  const resolvedPresets = useMemo(
    () => resolvePresetSelection(presetLibrary, presetSelection),
    [presetLibrary, presetSelection],
  )
  const presetConfig = useMemo(() => {
    const active = resolvedPresets.filter((item): item is ResolvedPreset => item !== null)
    return active.length ? (Object.assign({}, ...active.map((item) => item.config)) as Record<string, string>) : null
  }, [resolvedPresets])
  const fileLayerTime = meta ? slicerMinimumLayerTime(meta.slicer.config) : null
  const referenceVirtual = useMemo(
    () => ({
      ...currentProfile,
      maxPrintSpeed: Math.round(typicalSpeed),
      minimumLayerTime: fileLayerTime ?? currentProfile.minimumLayerTime,
    }),
    [currentProfile, typicalSpeed, fileLayerTime],
  )
  const upgradeBase = useMemo(
    () => profileWithFilament(referenceVirtual, currentProfile, resolvedPresets[1], fileLayerTime),
    [referenceVirtual, currentProfile, resolvedPresets, fileLayerTime],
  )
  const scenarios = useMemo(() => buildScenarios(upgradeBase), [upgradeBase])

  const virtualJob = (profile: PrinterSettings): EvalJob => ({
    profile,
    policy: 'virtual_limits',
    typicalSpeed,
    config: presetConfig,
  })
  const baselineKey = meta ? JSON.stringify([generation, currentProfile]) : ''
  const simulationKey = meta ? JSON.stringify([generation, virtualProfile, typicalSpeed, presetConfig]) : ''
  const scenariosKey = meta ? JSON.stringify([generation, upgradeBase, typicalSpeed, presetConfig]) : ''

  useEffect(() => {
    if (!baselineKey) return
    void engine
      .evaluate([{ profile: currentProfile, policy: 'as_emitted' }], 'baseline')
      .then((results) => results && setBaseline({ key: baselineKey, value: results[0] }))
    // The key captures every input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baselineKey, engine])

  useEffect(() => {
    if (!simulationKey) return
    void engine.evaluate([virtualJob(virtualProfile)], 'simulation').then((results) => {
      if (results) setSimulation({ key: simulationKey, value: results[0] })
    })
    const changed = LEVERS.map((lever) => lever.key).filter(
      (key) => virtualProfile[key] !== upgradeBase[key],
    )
    if (!changed.length) return
    void engine
      .evaluate(
        [virtualJob(virtualProfile), ...changed.map((key) => virtualJob({ ...virtualProfile, [key]: upgradeBase[key] }))],
        'effects',
      )
      .then((results) => {
        if (!results) return
        const values: Partial<Record<LeverKey, number>> = {}
        changed.forEach((key, index) => {
          values[key] = results[index + 1].estimatedSeconds - results[0].estimatedSeconds
        })
        setEffects({ key: simulationKey, value: values })
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simulationKey, engine])

  useEffect(() => {
    if (!scenariosKey) return
    void engine
      .evaluate(
        [virtualJob(upgradeBase), ...scenarios.map((scenario) => virtualJob(scenario.profile))],
        'scenarios',
      )
      .then((results) => results && setScenarioRuns({ key: scenariosKey, value: results }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenariosKey, engine])

  const baselineResult = baseline?.value ?? null
  const simulationResult = simulation?.value ?? null
  const simulationFresh = simulation?.key === simulationKey
  const virtualBaseline =
    scenarioRuns?.key === scenariosKey && scenarioRuns.value.length > 0 ? scenarioRuns.value[0] : null
  const outcomes = useMemo(() => {
    if (!virtualBaseline || scenarioRuns?.key !== scenariosKey) return null
    const total = virtualBaseline.estimatedSeconds
    return Object.fromEntries(
      scenarios.map((scenario, index) => {
        const seconds = scenarioRuns.value[index + 1].estimatedSeconds
        const saved = total - seconds
        return [scenario.id, { seconds, saved, savedShare: total > 0 ? (saved / total) * 100 : 0 }]
      }),
    ) as Record<ScenarioId, ScenarioOutcome>
  }, [virtualBaseline, scenarioRuns, scenariosKey, scenarios])
  const leverEffects = effects?.key === simulationKey ? effects.value : null
  const activeScenario = scenarios.find((scenario) => sameProfile(scenario.profile, virtualProfile))?.id ?? null
  const upgraded = !sameProfile(virtualProfile, referenceVirtual) || presetConfig !== null
  const resliceChanges = useMemo(
    () =>
      meta
        ? resliceChangesFromProfiles(upgradeBase, virtualProfile, simulationResult?.envelopeBreaches ?? [])
        : null,
    [meta, upgradeBase, virtualProfile, simulationResult],
  )
  const resliceKey = resliceChangesKey(resliceChanges)

  const onOrcaStatus = useEffectEvent((status: OrcaStatus) => {
    setOrcaStatus((prev) => (JSON.stringify(prev) === JSON.stringify(status) ? prev : status))
    if (status.gcode && !orcaRequested.current.gcode && !source) {
      orcaRequested.current.gcode = true
      void loadFromOrca(status.gcode.modified)
    }
    if (status.presets && !orcaRequested.current.presets) {
      orcaRequested.current.presets = true
      void loadOrcaPresets()
    }
  })

  useEffect(() => {
    const bridge = connectOrca((status) => onOrcaStatus(status))
    if (!bridge) return
    orcaBridge.current = bridge
    bridge.hello()
    const timer = window.setInterval(() => bridge.hello(), 3000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (resliceState.status !== 'running') return
    setResliceNow(Date.now())
    const timer = window.setInterval(() => setResliceNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [resliceState.status])

  async function loadSource(next: Source) {
    setError('')
    try {
      const loaded = await engine.load(
        next.kind === 'file' ? { kind: 'file', file: next.file } : { kind: 'text', text: next.text },
      )
      const { settings, applied } = settingsFromSlicerMetadata(
        loaded.meta.slicer,
        DEFAULT_PRINTER_SETTINGS,
        loaded.meta.referenceAcceleration,
      )
      setGeneration((value) => value + 1)
      setMeta(loaded.meta)
      setTypicalSpeed(loaded.typicalSpeed)
      setCurrentProfile(settings)
      setVirtualProfile({
        ...settings,
        maxPrintSpeed: Math.round(loaded.typicalSpeed),
        minimumLayerTime: slicerMinimumLayerTime(loaded.meta.slicer.config) ?? settings.minimumLayerTime,
      })
      setFromFile(applied)
      setSource(next)
      setReport(null)
      setBaseline(null)
      setSimulation(null)
      setEffects(null)
      setScenarioRuns(null)
      setPresetSelection(NO_PRESETS)
      setResliceState({ status: 'idle' })
      setTab('overview')
      window.scrollTo({ top: 0 })
    } catch {
      setError(t.errors.parse)
    }
  }

  async function loadReportFile(file: File) {
    setError('')
    try {
      setReport(JSON.parse(await file.text()) as BottleneckReport)
      setFromFile([])
      setSource({ kind: 'file', file, name: file.name })
      setMeta(null)
      setBaseline(null)
      setSimulation(null)
    } catch {
      setError(t.errors.report)
    }
  }

  async function loadFromOrca(modified: number) {
    const bridge = orcaBridge.current
    if (!bridge) return
    setError('')
    try {
      const file = await bridge.request('gcode')
      await loadSource({ kind: 'text', text: file.text, name: file.name, origin: 'orca' })
      setOrcaLoadedAt(modified)
    } catch (reason) {
      setError(t.errors.orca((reason as Error).message))
    }
  }

  async function loadOrcaPresets() {
    const bridge = orcaBridge.current
    if (!bridge) return
    setPresetBusy(true)
    try {
      const file = await bridge.request('presets')
      setPresetLibrary(buildOrcaPresetLibrary([{ path: file.name, text: file.text }]))
      setPresetSelection(NO_PRESETS)
    } catch {
      // The folder / export-file pickers in the preset panel still work.
    } finally {
      setPresetBusy(false)
    }
  }

  async function loadPresetFiles(fileList: FileList) {
    setPresetBusy(true)
    try {
      const files = [...fileList].filter((file) => {
        const path = file.webkitRelativePath || file.name
        if (!file.webkitRelativePath) return /\.json$/i.test(path)
        return PRESET_FOLDER_FILE.test(path) && !/user_backup/i.test(path)
      })
      const entries = await Promise.all(
        files.map(async (file) => ({ path: file.webkitRelativePath || file.name, text: await file.text() })),
      )
      setPresetLibrary(buildOrcaPresetLibrary(entries))
      selectPresets(NO_PRESETS)
    } finally {
      setPresetBusy(false)
    }
  }

  function selectPresets(next: PresetSelection) {
    setPresetSelection(next)
    const resolved = resolvePresetSelection(presetLibrary, next)
    setVirtualProfile((profile) =>
      profileWithFilament(
        profile,
        currentProfile,
        resolved[1],
        slicerMinimumLayerTime(meta?.slicer.config ?? {}),
      ),
    )
  }

  function openFile(file: File) {
    if (file.name.toLowerCase().endsWith('.json')) void loadReportFile(file)
    else void loadSource({ kind: 'file', file, name: file.name })
  }

  function openDemo() {
    void loadSource({ kind: 'text', text: demoGcode(), name: t.intro.demo })
  }

  function applyScenario(id: ScenarioId) {
    const scenario = scenarios.find((item) => item.id === id)
    if (scenario) setVirtualProfile(scenario.profile)
    setTab('upgrades')
  }

  function tryCategory(category: Category) {
    const candidates = scenarios.filter(
      (scenario) => scenario.kind !== 'combo' && scenario.targets.includes(category),
    )
    const best = outcomes
      ? [...candidates].sort((a, b) => outcomes[b.id].saved - outcomes[a.id].saved)[0]
      : candidates[0]
    if (best) applyScenario(best.id)
    else setTab('upgrades')
  }

  function resetUpgrade() {
    setPresetSelection(NO_PRESETS)
    setVirtualProfile(referenceVirtual)
  }

  async function runReslice() {
    const bridge = orcaBridge.current
    if (!bridge || !resliceChanges) return
    const key = resliceKey
    setResliceState({ status: 'running', key, started: Date.now() })
    try {
      const result = await bridge.reslice(resliceChanges)
      setResliceState((prev) =>
        prev.status === 'running' && prev.key === key ? { status: 'done', key, result } : prev,
      )
    } catch (reason) {
      setResliceState((prev) =>
        prev.status === 'running' && prev.key === key
          ? { status: 'error', key, message: (reason as Error).message }
          : prev,
      )
    }
  }

  function onDrop(event: DragEvent) {
    event.preventDefault()
    setDragging(false)
    const file = event.dataTransfer.files?.[0]
    if (file) openFile(file)
  }

  const loading = activity.loading !== null
  const computingChannels = Object.keys(activity.computing)
  const activityText = loading
    ? t.activity.reading(formatPercent((activity.loading ?? 0) * 100))
    : activity.computing.scenarios !== undefined && computingChannels.length === 1
      ? t.activity.scenarios(formatPercent(activity.computing.scenarios * 100))
      : computingChannels.length
        ? t.activity.computing
        : ''
  const progress = loading
    ? activity.loading
    : computingChannels.length === 1 && activity.computing.scenarios !== undefined
      ? activity.computing.scenarios
      : null
  const orcaGcode = orcaStatus?.gcode ?? null
  const ready = Boolean(meta && baselineResult)
  const objects = meta?.slicer.objects ?? []
  const density = meta ? firstPositiveNumber(meta.slicer.config.filament_density) : null
  const confidence =
    baselineResult && meta
      ? timeConfidenceFromMetadata(baselineResult.estimatedSeconds, meta.slicer)
      : null
  const warnings = baselineResult?.warnings.map((warning) => warningText(warning, t)) ?? []

  return (
    <div
      className={`app ${dragging ? 'is-dragging' : ''}`}
      data-drop-text={t.intro.drop}
      onDragOver={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDragging(false)
      }}
      onDrop={onDrop}
    >
      <header className="topbar">
        <div className="brand">
          Bottleneck<span>3D</span>
        </div>
        {ready && (
          <nav className="tabs" role="tablist">
            {(['overview', 'time', 'upgrades', 'details'] as const).map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                className={tab === id ? 'is-active' : ''}
                onClick={() => setTab(id)}
              >
                {t.tabs[id]}
                {id === 'upgrades' && upgraded && <i className="tab-dot" />}
              </button>
            ))}
          </nav>
        )}
        {source && (
          <div className="file-chip" title={[...objects, source.name].join('\n')}>
            <b>
              {objects.length ? objects[0] : source.name}
              {objects.length > 1 && <em>+{objects.length - 1}</em>}
            </b>
            <span>
              {[
                objects.length && !isTempName(source.name) ? source.name : null,
                meta?.slicer.slicer || (report ? t.top.report : 'G-code'),
                `${formatNumber(sourceBytes(source) / 1048576, 1)} ${t.top.mb}`,
                source.kind === 'text' && source.origin === 'orca' ? t.top.viaOrca : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </div>
        )}
        <div className="topbar-actions">
          {activityText && (
            <span className="activity" role="status">
              <Spinner small /> {activityText}
            </span>
          )}
          {orcaGcode && orcaGcode.modified !== orcaLoadedAt && (
            <button
              className="btn"
              type="button"
              disabled={loading}
              title={orcaGcode.name}
              onClick={() => void loadFromOrca(orcaGcode.modified)}
            >
              {orcaLoadedAt ? t.top.refreshOrca : t.top.fromOrca}
            </button>
          )}
          {source && (
            <>
              <button className="btn-link" type="button" onClick={openDemo}>
                {t.top.demo}
              </button>
              <FilePicker className="btn btn-ghost" onFile={openFile}>
                {t.top.open}
              </FilePicker>
            </>
          )}
          <Segmented
            value={lang}
            onChange={setLang}
            options={[
              { value: 'ru', label: 'RU' },
              { value: 'en', label: 'EN' },
            ]}
          />
        </div>
        <div className={`activity-bar ${activityText ? 'is-on' : ''} ${progress === null ? 'is-indeterminate' : ''}`}>
          <i style={progress === null ? undefined : { width: `${progress * 100}%` }} />
        </div>
      </header>

      <main>
        {error && <div className="callout callout-error">{error}</div>}

        {!source && (
          <section className="intro">
            <div className="intro-copy">
              <p className="eyebrow">{t.intro.eyebrow}</p>
              <h1>{t.intro.title}</h1>
              {insideOrca && (
                <div className="callout callout-orca">
                  <b>{orcaStatus ? t.intro.orcaConnected : t.intro.orcaConnecting}</b> {t.intro.orcaHint}
                </div>
              )}
              <p className="lede">{t.intro.lede}</p>
              <div className="features">
                {t.intro.features.map(([title, text]) => (
                  <article key={title}>
                    <b>{title}</b>
                    <p>{text}</p>
                  </article>
                ))}
              </div>
            </div>
            <div className="intro-drop">
              <FilePicker className={`dropzone ${dragging ? 'is-active' : ''}`} onFile={openFile}>
                <span className="dropzone-icon" aria-hidden>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 15V4M7 9l5-5 5 5M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" />
                  </svg>
                </span>
                <strong>{loading ? activityText : t.intro.drop}</strong>
                <span>{t.intro.dropHint}</span>
              </FilePicker>
              <div className="intro-actions">
                <button className="btn btn-ghost" type="button" onClick={openDemo}>
                  {t.intro.demo}
                </button>
                <span className="muted">{t.intro.privacy}</span>
              </div>
            </div>
          </section>
        )}

        {source && meta && !baselineResult && (
          <div className="loading-state">
            <Spinner /> {activityText || t.activity.computing}
          </div>
        )}

        {ready && baselineResult && meta && (
          <div className="view" key={tab}>
            {tab === 'overview' && (
              <Overview
                baseline={baselineResult}
                confidence={confidence}
                density={density}
                diameter={currentProfile.filamentDiameter}
                warnings={warnings}
                scenarios={scenarios}
                outcomes={outcomes}
                onTry={tryCategory}
                onOpenUpgrades={(id) => (id ? applyScenario(id) : setTab('upgrades'))}
              />
            )}
            {tab === 'time' && (
              <TimeView
                baseline={baselineResult}
                simulation={simulationResult}
                upgraded={upgraded}
                accelerations={meta.emittedAccelerations}
              />
            )}
            {tab === 'upgrades' && (
              <Upgrades
                baseline={virtualBaseline ?? baselineResult}
                confidence={confidence}
                simulation={simulationResult}
                computing={!simulationFresh}
                scenarios={scenarios}
                outcomes={outcomes}
                activeScenario={activeScenario}
                reference={upgradeBase}
                virtual={virtualProfile}
                typicalSpeed={typicalSpeed}
                effects={leverEffects}
                onScenario={applyScenario}
                onLever={(key, value) => setVirtualProfile((profile) => ({ ...profile, [key]: value }))}
                onReset={resetUpgrade}
                reslice={
                  orcaStatus?.reslice
                    ? {
                        available: true,
                        canRun: resliceChanges !== null,
                        busy: resliceState.status === 'running',
                        elapsedSec:
                          resliceState.status === 'running'
                            ? Math.max(0, Math.round((resliceNow - resliceState.started) / 1000))
                            : 0,
                        stale:
                          (resliceState.status === 'done' || resliceState.status === 'error') &&
                          resliceState.key !== resliceKey,
                        error:
                          resliceState.status === 'error' && resliceState.key === resliceKey
                            ? resliceState.message
                            : '',
                        orcaDelta:
                          resliceState.status === 'done'
                            ? resliceState.result.seconds - resliceState.result.baselineSeconds
                            : null,
                        onRun: () => void runReslice(),
                      }
                    : null
                }
                presets={
                  <details className="presets-box" open={presetLibrary !== null}>
                    <summary>{t.upgrades.presets}</summary>
                    <OrcaPresetPanel
                      library={presetLibrary}
                      selection={presetSelection}
                      resolved={resolvedPresets}
                      fileConfig={meta.slicer.config}
                      busy={presetBusy}
                      onFiles={(files) => void loadPresetFiles(files)}
                      onSelect={selectPresets}
                    />
                  </details>
                }
              />
            )}
            {tab === 'details' && (
              <Details
                meta={meta}
                profile={currentProfile}
                applied={fromFile}
                onChange={(key, value) => {
                  setCurrentProfile((profile) => ({ ...profile, [key]: value }))
                  if (key !== 'maxPrintSpeed' && key !== 'minimumLayerTime') {
                    setVirtualProfile((profile) =>
                      profile[key] === referenceVirtual[key] ? { ...profile, [key]: value } : profile,
                    )
                  }
                }}
              />
            )}
          </div>
        )}

        {report && <ReportViewer report={report} />}
      </main>

      <footer>{t.footer}</footer>
    </div>
  )
}
