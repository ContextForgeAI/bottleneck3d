// Usage: npm run compare -- <file.gcode|folder> [...] [--accel N] [--flow N] [--speed N]
import { createReadStream, statSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { evaluateWorkload, GcodeParser } from '../src/analyzer.ts'
import {
  DEFAULT_PRINTER_SETTINGS,
  type PrinterSettings,
} from '../src/domain/profile.ts'
import type { JunctionModel } from '../src/motion-planner.ts'
import {
  compareWithSlicer,
  settingsFromSlicerMetadata,
} from '../src/slicer-metadata.ts'

const GCODE_EXTENSIONS = new Set(['.gcode', '.gco', '.gc'])
const JUNCTION_MODELS: Array<[JunctionModel | undefined, string]> = [
  [undefined, 'auto'],
  ['prusa_jerk', 'prusa'],
  ['orca_jerk', 'orca'],
  ['orca_klipper', 'orca_klipper'],
  ['klipper', 'klipper'],
]
const overrideFlags: Record<string, keyof PrinterSettings> = {
  '--accel': 'acceleration',
  '--flow': 'maxVolumetricFlow',
  '--speed': 'maxPrintSpeed',
}

function parseArgs(argv: string[]) {
  const inputs: string[] = []
  const overrides: Partial<PrinterSettings> = {}

  for (let index = 0; index < argv.length; index += 1) {
    const field = overrideFlags[argv[index]]
    if (field) {
      overrides[field] = Number(argv[index + 1])
      index += 1
    } else {
      inputs.push(argv[index])
    }
  }

  return { inputs, overrides }
}

function collectFiles(inputs: string[]): string[] {
  return inputs.flatMap((input) => {
    if (!statSync(input).isDirectory()) return [input]
    return readdirSync(input)
      .filter((name) => GCODE_EXTENSIONS.has(path.extname(name).toLowerCase()))
      .map((name) => path.join(input, name))
  })
}

async function parseFile(file: string) {
  const parser = new GcodeParser()
  const lines = createInterface({
    input: createReadStream(file, 'utf8'),
    crlfDelay: Infinity,
  })
  for await (const line of lines) parser.push(line)
  return parser.finish()
}

function formatTime(seconds: number): string {
  const rounded = Math.round(seconds)
  const hours = Math.floor(rounded / 3600)
  const minutes = Math.floor((rounded % 3600) / 60)
  const rest = rounded % 60
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
}

function formatDelta(value: number): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}`
}

const { inputs, overrides } = parseArgs(process.argv.slice(2))
if (!inputs.length) {
  console.error(
    'Укажи G-code или папку: npm run compare -- <file.gcode|folder> [--accel N] [--flow N] [--speed N]',
  )
  process.exit(1)
}

const rows = []
const spreads = new Map<string, number[]>()
for (const file of collectFiles(inputs)) {
  const workload = await parseFile(file)
  const { settings } = settingsFromSlicerMetadata(
    workload.slicer,
    DEFAULT_PRINTER_SETTINGS,
    workload.referenceAcceleration,
  )
  const profile = { ...settings, ...overrides }
  const row: Record<string, string | number> = {
    file: path.basename(file),
    slicer: workload.slicer.slicer ?? '?',
    slicerTime: workload.slicer.estimatedSeconds
      ? formatTime(workload.slicer.estimatedSeconds)
      : '—',
  }

  for (const [junction, label] of JUNCTION_MODELS) {
    const result = evaluateWorkload(workload, profile, 'as_emitted', undefined, {
      junction,
    })
    const comparison = compareWithSlicer(result.estimatedSeconds, workload.slicer)
    row[label] = formatTime(result.estimatedSeconds)
    row[`${label}Δ%`] = comparison ? formatDelta(comparison.deltaPercent) : '—'
    if (comparison) {
      spreads.set(label, [...(spreads.get(label) ?? []), comparison.deltaPercent])
    }
  }

  rows.push(row)
}

console.table(rows)
for (const [label, deltas] of spreads) {
  const meanAbs = deltas.reduce((sum, value) => sum + Math.abs(value), 0) / deltas.length
  const worst = Math.max(...deltas.map(Math.abs))
  console.log(
    `${label}: средняя |Δ| ${meanAbs.toFixed(1)}%, худшая ${worst.toFixed(1)}% по ${deltas.length} файлам`,
  )
}
