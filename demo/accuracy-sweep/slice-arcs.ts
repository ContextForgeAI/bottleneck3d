/**
 * Нарезка enable_arc_fitting=1 и сверка audit до/после учёта G2/G3.
 *   node demo/accuracy-sweep/slice-arcs.ts
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { evaluateWorkload, parseGcodeText } from '../../src/analyzer.ts'
import { DEFAULT_PRINTER_SETTINGS } from '../../src/domain/profile.ts'
import { settingsFromSlicerMetadata } from '../../src/slicer-metadata.ts'
import { flattenPresets, MODELS, prepareModels, TEMP_ROOT } from './flatten-presets.ts'
import { clonePreset, setScalar, sliceWithOrca } from './orca-cli.ts'

const GCODE_ROOT = path.join(TEMP_ROOT, 'gcode')
const WORK_ROOT = path.join(TEMP_ROOT, 'work')
const WANTED = ['cube', 'penholder', 'dragon', 'quartz']

function countArcs(text: string): { g2: number; g3: number } {
  let g2 = 0
  let g3 = 0
  for (const line of text.split(/\r?\n/)) {
    const command = line.split(';', 1)[0].trim().toUpperCase().match(/^[A-Z]\d+/)?.[0]
    if (command === 'G2') g2 += 1
    else if (command === 'G3') g3 += 1
  }
  return { g2, g3 }
}

function auditSeconds(gcode: string): { ours: number; orca: number | null; arcs: number } {
  const workload = parseGcodeText(gcode)
  const { settings } = settingsFromSlicerMetadata(
    workload.slicer,
    DEFAULT_PRINTER_SETTINGS,
    workload.referenceAcceleration,
  )
  const result = evaluateWorkload(workload, settings, 'as_emitted')
  return {
    ours: result.estimatedSeconds,
    orca: workload.slicer.estimatedSeconds,
    arcs: workload.arcCount,
  }
}

function stripArcs(gcode: string): string {
  return gcode.replace(/^(G2|G3)\b.*$/gim, '; stripped arc')
}

const flat = flattenPresets(path.join(TEMP_ROOT, 'flat'))
const modelsDir = prepareModels()
const rows = []

for (const model of MODELS.filter((item) => WANTED.includes(item.id))) {
  const cacheDir = path.join(GCODE_ROOT, model.id)
  mkdirSync(cacheDir, { recursive: true })
  const cachePath = path.join(cacheDir, 'arc_fitting.gcode')
  const modelPath = path.join(modelsDir, model.dest)
  if (!existsSync(modelPath)) {
    console.log(`${model.id}: нет модели ${modelPath}`)
    continue
  }
  if (!existsSync(cachePath)) {
    const process = clonePreset(flat.process)
    setScalar(process, 'enable_arc_fitting', 1)
    const workDir = path.join(WORK_ROOT, model.id, 'arc_fitting')
    console.log(`slice ${model.id} arc_fitting ...`)
    const sliced = await sliceWithOrca({
      modelPath,
      outputDir: workDir,
      machine: clonePreset(flat.machine),
      process,
      filament: clonePreset(flat.filament),
      timeoutMs: model.id === 'cube' ? 90_000 : 600_000,
    })
    if (!sliced.ok || !sliced.gcodePath) {
      console.log(
        `${model.id}: FAIL exit=${sliced.exitCode} killed=${sliced.killed} ${sliced.stderr.slice(0, 200)} ${sliced.stdout.slice(0, 120)}`,
      )
      continue
    }
    copyFileSync(sliced.gcodePath, cachePath)
    console.log(`${model.id}: sliced ${sliced.elapsedMs}ms -> ${cachePath}`)
  } else {
    console.log(`${model.id}: cache ${cachePath}`)
  }

  const text = readFileSync(cachePath, 'utf8')
  const counts = countArcs(text)
  console.log(`${model.id}: parsing ${text.length} chars, G2=${counts.g2} G3=${counts.g3}`)
  const after = auditSeconds(text)
  const before = auditSeconds(stripArcs(text))
  const delta = (ours: number, orca: number | null) =>
    orca ? ((ours - orca) / orca) * 100 : null
  rows.push({
    model: model.id,
    g2: counts.g2,
    g3: counts.g3,
    orca: after.orca,
    before: before.ours,
    beforePct: delta(before.ours, after.orca),
    after: after.ours,
    afterPct: delta(after.ours, after.orca),
    parserArcs: after.arcs,
  })
}

console.log(JSON.stringify(rows, null, 2))
