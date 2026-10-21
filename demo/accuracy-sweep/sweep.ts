/**
 * Сетка нарезки Orca × погрешности Bottleneck3D (audit / what-if).
 *
 *   node demo/accuracy-sweep/sweep.ts
 *   node demo/accuracy-sweep/sweep.ts --models cube,quartz
 *   node demo/accuracy-sweep/sweep.ts --analyze-only
 */
import { copyFileSync, createReadStream, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluateWorkload, GcodeParser, inferTypicalExtrusionSpeed } from '../../src/analyzer.ts'
import {
  DEFAULT_PRINTER_SETTINGS,
  type PrinterSettings,
} from '../../src/domain/profile.ts'
import type { PrintWorkload } from '../../src/domain/workload.ts'
import { settingsFromSlicerMetadata, slicerMinimumLayerTime } from '../../src/slicer-metadata.ts'
import {
  flattenPresets,
  MODELS,
  prepareModels,
  TEMP_ROOT,
  type PresetJson,
} from './flatten-presets.ts'
import {
  clonePreset,
  scaleScalar,
  setScalar,
  sliceWithOrca,
} from './orca-cli.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const RESULTS_CSV = path.join(HERE, 'results.csv')
const SUMMARY_MD = path.join(HERE, 'summary.md')
const REPORT_MD = path.join(HERE, 'REPORT.md')
const GCODE_ROOT = path.join(TEMP_ROOT, 'gcode')
const WORK_ROOT = path.join(TEMP_ROOT, 'work')
const MAX_PRINT_SECONDS = 3 * 3600

const PRINT_ACCEL_KEYS = [
  'default_acceleration',
  'outer_wall_acceleration',
  'inner_wall_acceleration',
  'top_surface_acceleration',
] as const
const PRINT_SPEED_KEYS = [
  'outer_wall_speed',
  'inner_wall_speed',
  'sparse_infill_speed',
  'internal_solid_infill_speed',
  'top_surface_speed',
] as const
const JERK_KEYS = [
  'default_jerk',
  'outer_wall_jerk',
  'inner_wall_jerk',
  'infill_jerk',
  'top_surface_jerk',
  'travel_jerk',
] as const
const MACHINE_ACCEL_KEYS = [
  'machine_max_acceleration_x',
  'machine_max_acceleration_y',
  'machine_max_acceleration_extruding',
  'machine_max_acceleration_travel',
] as const

type LeverPatch = Partial<PrinterSettings> | 'none'

interface Variant {
  id: string
  group: string
  param: string
  value: string
  numeric: number
  lever: LeverPatch
  apply: (ctx: { machine: PresetJson; process: PresetJson; filament: PresetJson }) => void
}

interface Row {
  model: string
  group: string
  param: string
  value: string
  orca_s: string
  b3d_audit_s: string
  audit_err_pct: string
  b3d_whatif_s: string
  whatif_err_pct: string
  real_delta_s: string
  pred_delta_s: string
  delta_err_pct: string
  segments: string
  notes: string
}

function parseArgs(argv: string[]) {
  const models = new Set<string>()
  let analyzeOnly = false
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--analyze-only') analyzeOnly = true
    else if (arg === '--models') {
      for (const id of (argv[index + 1] ?? '').split(',')) {
        if (id.trim()) models.add(id.trim())
      }
      index += 1
    }
  }
  return { models, analyzeOnly }
}

function variants(): Variant[] {
  const out: Variant[] = [
    {
      id: 'base',
      group: 'base',
      param: 'base',
      value: '1',
      numeric: 1,
      lever: {},
      apply: () => {},
    },
  ]
  for (const k of [0.5, 1, 2, 4]) {
    out.push({
      id: `print_accel_k${k}`,
      group: 'print_accel',
      param: 'print_acceleration_x',
      value: String(k),
      numeric: k,
      lever: { acceleration: k },
      apply: ({ process }) => {
        for (const key of PRINT_ACCEL_KEYS) scaleScalar(process, key, k)
      },
    })
  }
  for (const k of [2, 4]) {
    out.push({
      id: `print_accel_k${k}_raised`,
      group: 'print_accel_raised',
      param: 'print_acceleration_x_machine',
      value: String(k),
      numeric: k,
      lever: { acceleration: k },
      apply: ({ process, machine }) => {
        for (const key of PRINT_ACCEL_KEYS) scaleScalar(process, key, k)
        for (const key of MACHINE_ACCEL_KEYS) scaleScalar(machine, key, k)
      },
    })
  }
  for (const v of [1500, 3000, 6000, 10000]) {
    out.push({
      id: `travel_accel_${v}`,
      group: 'travel_accel',
      param: 'travel_acceleration',
      value: String(v),
      numeric: v,
      lever: 'none',
      apply: ({ process }) => setScalar(process, 'travel_acceleration', v),
    })
  }
  for (const k of [0.5, 1, 1.5, 2]) {
    out.push({
      id: `print_speed_k${k}`,
      group: 'print_speed',
      param: 'print_speed_x',
      value: String(k),
      numeric: k,
      lever: { maxPrintSpeed: k },
      apply: ({ process }) => {
        for (const key of PRINT_SPEED_KEYS) scaleScalar(process, key, k)
      },
    })
  }
  for (const v of [150, 250, 400]) {
    out.push({
      id: `travel_speed_${v}`,
      group: 'travel_speed',
      param: 'travel_speed',
      value: String(v),
      numeric: v,
      lever: 'none',
      apply: ({ process }) => setScalar(process, 'travel_speed', v),
    })
  }
  for (const v of [8, 15, 23, 40]) {
    out.push({
      id: `flow_${v}`,
      group: 'flow',
      param: 'filament_max_volumetric_speed',
      value: String(v),
      numeric: v,
      lever: { maxVolumetricFlow: v },
      apply: ({ filament }) => setScalar(filament, 'filament_max_volumetric_speed', v),
    })
  }
  for (const v of [3000, 6000, 12000, 20000]) {
    out.push({
      id: `machine_accel_${v}`,
      group: 'machine_accel',
      param: 'machine_max_acceleration_xyet',
      value: String(v),
      numeric: v,
      lever: 'none',
      apply: ({ machine }) => {
        for (const key of MACHINE_ACCEL_KEYS) setScalar(machine, key, v)
      },
    })
  }
  for (const v of [200, 300, 500]) {
    out.push({
      id: `machine_speed_${v}`,
      group: 'machine_speed',
      param: 'machine_max_speed_xy',
      value: String(v),
      numeric: v,
      lever: 'none',
      apply: ({ machine }) => {
        setScalar(machine, 'machine_max_speed_x', v)
        setScalar(machine, 'machine_max_speed_y', v)
      },
    })
  }
  for (const v of [5, 9, 15, 25]) {
    out.push({
      id: `jerk_${v}`,
      group: 'jerk',
      param: 'role_jerk',
      value: String(v),
      numeric: v,
      lever: 'none',
      apply: ({ process }) => {
        for (const key of JERK_KEYS) setScalar(process, key, v)
      },
    })
  }
  for (const v of [0, 6, 15]) {
    out.push({
      id: `cooling_${v}`,
      group: 'cooling',
      param: 'slow_down_layer_time',
      value: String(v),
      numeric: v,
      lever: { minimumLayerTime: v },
      apply: ({ filament }) => setScalar(filament, 'slow_down_layer_time', v),
    })
  }
  for (const v of [0.12, 0.2, 0.28]) {
    out.push({
      id: `layer_${v}`,
      group: 'layer_height',
      param: 'layer_height',
      value: String(v),
      numeric: v,
      lever: 'none',
      apply: ({ process }) => {
        setScalar(process, 'layer_height', v)
        setScalar(process, 'initial_layer_print_height', v)
      },
    })
  }
  return out
}

async function parseFile(file: string): Promise<PrintWorkload> {
  const parser = new GcodeParser()
  const lines = createInterface({
    input: createReadStream(file, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  })
  for await (const line of lines) parser.push(line)
  return parser.finish()
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`
  return value
}

function fmt(value: number | null, digits = 3): string {
  if (value === null || !Number.isFinite(value)) return ''
  return value.toFixed(digits)
}

function whatIfProfile(
  baseSettings: PrinterSettings,
  typicalSpeed: number,
  lever: LeverPatch,
  config: Record<string, string>,
): PrinterSettings | null {
  if (lever === 'none') return null
  const profile: PrinterSettings = {
    ...baseSettings,
    maxPrintSpeed: Math.round(typicalSpeed),
    minimumLayerTime: slicerMinimumLayerTime(config) ?? baseSettings.minimumLayerTime,
  }
  if (lever.acceleration !== undefined) {
    profile.acceleration = baseSettings.acceleration * lever.acceleration
  }
  if (lever.maxPrintSpeed !== undefined) {
    profile.maxPrintSpeed = Math.round(typicalSpeed * lever.maxPrintSpeed)
  }
  if (lever.maxVolumetricFlow !== undefined) {
    profile.maxVolumetricFlow = lever.maxVolumetricFlow
  }
  if (lever.minimumLayerTime !== undefined) {
    profile.minimumLayerTime = lever.minimumLayerTime
  }
  return profile
}

function meanAbs(values: number[]): string {
  if (!values.length) return '—'
  return (values.reduce((sum, value) => sum + Math.abs(value), 0) / values.length).toFixed(2)
}

function worstAbs(values: number[]): string {
  if (!values.length) return '—'
  return Math.max(...values.map(Math.abs)).toFixed(2)
}

function writeCsv(rows: Row[]): void {
  const header = [
    'model',
    'group',
    'param',
    'value',
    'orca_s',
    'b3d_audit_s',
    'audit_err_pct',
    'b3d_whatif_s',
    'whatif_err_pct',
    'real_delta_s',
    'pred_delta_s',
    'delta_err_pct',
    'segments',
    'notes',
  ]
  const lines = [header.join(','), ...rows.map((row) => header.map((key) => csvEscape(row[key as keyof Row])).join(','))]
  writeFileSync(RESULTS_CSV, `${lines.join('\n')}\n`, 'utf8')
}

function writeReport(
  rows: Row[],
  cliCommand: string,
  skipped: string[],
): void {
  const groups = [...new Set(rows.map((row) => row.group))]
  const table = [
    '| Группа | n | средн. \\|audit\\| % | худш. \\|audit\\| % | средн. \\|whatif\\| % | худш. \\|whatif\\| % | средн. \\|delta\\| % | худш. \\|delta\\| % |',
    '|---|---:|---:|---:|---:|---:|---:|---:|',
  ]
  for (const group of groups) {
    const subset = rows.filter((row) => row.group === group)
    const take = (key: keyof Row) =>
      subset
        .map((row) => row[key])
        .filter((value) => value !== '')
        .map(Number)
        .filter(Number.isFinite)
    const audit = take('audit_err_pct')
    const whatif = take('whatif_err_pct')
    const delta = take('delta_err_pct')
    table.push(
      `| ${group} | ${subset.length} | ${meanAbs(audit)} | ${worstAbs(audit)} | ${meanAbs(whatif)} | ${worstAbs(whatif)} | ${meanAbs(delta)} | ${worstAbs(delta)} |`,
    )
  }

  const ranked = [...rows]
    .filter((row) => row.audit_err_pct || row.whatif_err_pct || row.delta_err_pct)
    .sort((a, b) => {
      const score = (row: Row) =>
        Math.max(
          Math.abs(Number(row.delta_err_pct) || 0),
          Math.abs(Number(row.whatif_err_pct) || 0),
          Math.abs(Number(row.audit_err_pct) || 0),
        )
      return score(b) - score(a)
    })
    .slice(0, 10)

  const worstLines = ranked.map((row, index) => {
    return `${index + 1}. **${row.model} / ${row.group} / ${row.param}=${row.value}** — audit ${row.audit_err_pct || '—'}%, whatif ${row.whatif_err_pct || '—'}%, delta ${row.delta_err_pct || '—'}%. orca=${row.orca_s}s, notes: ${row.notes || '—'}`
  })

  const md = `# Отчёт: погрешность Bottleneck3D vs Orca (Voron 2.4 R2 300)

Автосбор по \`demo/accuracy-sweep/sweep.ts\`. Пресет процесса: Voron 0.20 Verify Cube, филамент Voron PLA Star Plast, машина Voron 2.4 R2 300 0.4 (Klipper). OrcaSlicer 2.5.0-alpha.

## Команда CLI, которая сработала

Плоские пресеты (без \`inherits\`, уникальные имена, \`compatible_printers: []\`), два флага \`--load-settings\`, без \`--datadir\` и без \`--export-3mf\`:

\`\`\`
${cliCommand}
\`\`\`

Перезапуск всего прогона:

\`\`\`
node demo/accuracy-sweep/sweep.ts
\`\`\`

Кэш G-code: \`%TEMP%\\b3d-sweep\\gcode\\\`. Повторный анализ без нарезки: \`node demo/accuracy-sweep/sweep.ts --analyze-only\`.

## Сводка по группам

${table.join('\n')}

\`audit_err = (B3D(gcode_v) − Orca(gcode_v)) / Orca(gcode_v)\`.
\`whatif_err = (B3D_whatif(gcode_base, v) − Orca(gcode_v)) / Orca(gcode_v)\`.
\`delta_err = (pred_delta − real_delta) / |real_delta|\`.

What-if считается как вкладка «Апгрейды»: \`virtual_limits\` + \`typicalSpeed\` (p90 emitted F), \`maxPrintSpeed\` рычага = typical×k. Для travel / лимитов машины / jerk / layer_height рычага нет — только audit.

## Топ худших случаев

${worstLines.join('\n') || '_нет строк_'}

## Пропуски

${skipped.length ? skipped.map((item) => `- ${item}`).join('\n') : '- нет'}

## Как трактовать (черновик)

После прогона смотрите числа в таблице: цель audit |err| ≤ 1% (сейчас у Orca 2.5 + Klipper ожидаемо около +3.8% до порта \`plan_klipper\`); what-if delta ≤ 15% для ускорения и потока, ≤ 25% для скоростей.

Полные гипотезы по худшим ячейкам — ниже по факту CSV; этот файл перезаписывается скриптом, уточнения добавляются вручную в том же REPORT.md после просмотра.
`
  writeFileSync(SUMMARY_MD, md, 'utf8')
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  mkdirSync(GCODE_ROOT, { recursive: true })
  mkdirSync(WORK_ROOT, { recursive: true })
  const flat = flattenPresets(path.join(TEMP_ROOT, 'flat'))
  const modelsDir = prepareModels()
  const allVariants = variants()
  const modelList = MODELS.filter((model) => args.models.size === 0 || args.models.has(model.id))
  const skipped: string[] = []
  const rows: Row[] = []
  const exampleCommand = [
    ORCA_EXAMPLE,
    '--slice 0 --arrange 1 --allow-newer-file',
    '--load-settings <flat/machine.json>',
    '--load-settings <flat/process.json>',
    '--load-filaments <flat/filament.json>',
    '--outputdir <out>',
    '<model.stl>',
  ].join(' ')

  const bases = new Map<string, { workload: PrintWorkload; orca: number; audit: number }>()

  for (const model of modelList) {
    const modelPath = path.join(modelsDir, model.dest)
    console.log(`\n=== модель ${model.id} ===`)
    for (const variant of allVariants) {
      const cacheName = `${variant.id}.gcode`
      const cacheDir = path.join(
        GCODE_ROOT,
        model.scale && model.scale !== 1 ? `${model.id}_x${model.scale}` : model.id,
      )
      mkdirSync(cacheDir, { recursive: true })
      const cachePath = path.join(cacheDir, cacheName)
      let gcodePath = cachePath
      const notes: string[] = []

      if (args.analyzeOnly && !existsSync(cachePath)) {
        skipped.push(`${model.id}/${variant.id}: нет кэша ${cachePath}`)
        continue
      }

      if (!args.analyzeOnly && existsSync(cachePath)) {
        notes.push('cache')
      } else if (!args.analyzeOnly) {
        const machine = clonePreset(flat.machine)
        const process = clonePreset(flat.process)
        const filament = clonePreset(flat.filament)
        variant.apply({ machine, process, filament })
        const workDir = path.join(WORK_ROOT, model.id, variant.id)
        console.log(`  slice ${variant.id} ...`)
        const sliced = await sliceWithOrca({
          modelPath,
          outputDir: workDir,
          machine,
          process,
          filament,
          timeoutMs: model.id === 'cube' ? 60_000 : 240_000,
          scale: model.scale,
        })
        if (!sliced.ok || !sliced.gcodePath) {
          notes.push(
            `slice fail exit=${sliced.exitCode} killed=${sliced.killed} stderr=${sliced.stderr.slice(0, 180)} stdout=${sliced.stdout.slice(0, 120)}`,
          )
          skipped.push(`${model.id}/${variant.id}: ${notes.at(-1)}`)
          console.warn(`    FAIL ${notes.at(-1)}`)
          rows.push({
            model: model.id,
            group: variant.group,
            param: variant.param,
            value: variant.value,
            orca_s: '',
            b3d_audit_s: '',
            audit_err_pct: '',
            b3d_whatif_s: '',
            whatif_err_pct: '',
            real_delta_s: '',
            pred_delta_s: '',
            delta_err_pct: '',
            segments: '',
            notes: notes.join('; '),
          })
          writeCsv(rows)
          continue
        }
        copyFileSync(sliced.gcodePath, cachePath)
        gcodePath = cachePath
        notes.push(`slice_ms=${sliced.elapsedMs}`)
        console.log(`    ok ${sliced.elapsedMs}ms`)
      }

      let workload: PrintWorkload
      try {
        workload = await parseFile(gcodePath)
      } catch (error) {
        skipped.push(`${model.id}/${variant.id}: parse ${error}`)
        continue
      }
      const orca = workload.slicer.estimatedSeconds
      if (orca && orca > MAX_PRINT_SECONDS && variant.id === 'base') {
        skipped.push(`${model.id}: оценка Orca ${fmt(orca, 0)}s > 3ч, остальные варианты модели пропущены`)
        console.warn(`    skip model, print ${orca}s`)
        notes.push('print>3h')
      }
      const { settings } = settingsFromSlicerMetadata(
        workload.slicer,
        DEFAULT_PRINTER_SETTINGS,
        workload.referenceAcceleration,
      )
      const audit = evaluateWorkload(workload, settings, 'as_emitted')
      const auditSeconds = audit.estimatedSeconds
      const auditErr = orca ? (auditSeconds - orca) / orca : null

      if (variant.id === 'base' && orca) {
        bases.set(model.id, { workload, orca, audit: auditSeconds })
      }

      let whatifSeconds: number | null = null
      let whatifErr: number | null = null
      let realDelta: number | null = null
      let predDelta: number | null = null
      let deltaErr: number | null = null
      const base = bases.get(model.id)
      if (variant.lever === 'none') {
        notes.push('рычага нет')
      } else if (!base) {
        notes.push('нет базы для what-if')
      } else {
        const typical = inferTypicalExtrusionSpeed(base.workload)
        const { settings: baseSettings } = settingsFromSlicerMetadata(
          base.workload.slicer,
          DEFAULT_PRINTER_SETTINGS,
          base.workload.referenceAcceleration,
        )
        const profile = whatIfProfile(
          baseSettings,
          typical,
          variant.lever,
          base.workload.slicer.config,
        )
        if (profile) {
          const whatif = evaluateWorkload(
            base.workload,
            profile,
            'virtual_limits',
            typical,
          )
          whatifSeconds = whatif.estimatedSeconds
          if (orca) whatifErr = (whatifSeconds - orca) / orca
          realDelta = orca ? orca - base.orca : null
          predDelta = whatifSeconds - base.audit
          if (realDelta !== null && Math.abs(realDelta) >= 0.5) {
            deltaErr = (predDelta - realDelta) / Math.abs(realDelta)
          } else {
            notes.push('real_delta≈0')
          }
        }
      }

      rows.push({
        model: model.id,
        group: variant.group,
        param: variant.param,
        value: variant.value,
        orca_s: fmt(orca),
        b3d_audit_s: fmt(auditSeconds),
        audit_err_pct: auditErr === null ? '' : (auditErr * 100).toFixed(3),
        b3d_whatif_s: fmt(whatifSeconds),
        whatif_err_pct: whatifErr === null ? '' : (whatifErr * 100).toFixed(3),
        real_delta_s: fmt(realDelta),
        pred_delta_s: fmt(predDelta),
        delta_err_pct: deltaErr === null ? '' : (deltaErr * 100).toFixed(3),
        segments: String(workload.segments.length),
        notes: notes.join('; '),
      })
      writeCsv(rows)
      if (orca && orca > MAX_PRINT_SECONDS && variant.id === 'base') {
        writeReport(rows, exampleCommand, skipped)
        break
      }
    }
  }

  writeCsv(rows)
  writeReport(rows, exampleCommand, skipped)
  console.log(`\nготово: ${rows.length} строк → ${RESULTS_CSV}`)
  console.log(`сводка таблиц: ${SUMMARY_MD}`)
  console.log(`отчёт: ${REPORT_MD}`)
}

const ORCA_EXAMPLE = '"C:\\Program Files\\OrcaSlicer\\orca-slicer.exe"'

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
