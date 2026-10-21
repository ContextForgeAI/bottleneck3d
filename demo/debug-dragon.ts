import { analyzeGcodeText, parseGcodeText } from '../src/analyzer.ts'
import { DEFAULT_PRINTER_SETTINGS } from '../src/domain/profile.ts'
import { readFileSync } from 'node:fs'

const gcode = readFileSync(
  String.raw`C:\Users\Developer\Downloads\DragonScalePot (1)_PLA_1h33m.gcode`,
  'utf8',
)

const profile = {
  ...DEFAULT_PRINTER_SETTINGS,
  maxVolumetricFlow: 10,
  maxPrintSpeed: 120,
  acceleration: 1500,
  minimumLayerTime: 12,
}

const workload = parseGcodeText(gcode)
const result = analyzeGcodeText(gcode, profile)

console.log({
  lines: workload.lineCount,
  moves: workload.moveCount,
  extrusionMoves: workload.extrusionMoveCount,
  arcs: workload.arcCount,
  layersHint: result.layerCount,
  estimatedSec: result.estimatedSeconds,
  estimatedH: (result.estimatedSeconds / 3600).toFixed(2),
  idealSec: result.idealSeconds,
  constraints: result.constraintSeconds,
  dominant: result.dominant,
  warnings: result.warnings,
})

const segs = workload.segments
const withE = segs.filter((s) => s.extrusionLength > 0)
const speeds = withE.map((s) => s.requestedSpeed).sort((a, b) => a - b)
const dists = withE.map((s) => s.distance)
const volumes = withE.map(
  (s) => s.extrusionLength * Math.PI * (1.75 / 2) ** 2,
)

function pct(arr: number[], p: number) {
  if (!arr.length) return null
  const i = Math.floor((arr.length - 1) * p)
  return arr[i]
}

console.log({
  extrudeSegs: withE.length,
  speedMin: speeds[0],
  speedP50: pct(speeds, 0.5),
  speedP90: pct(speeds, 0.9),
  speedMax: speeds[speeds.length - 1],
  distSum: dists.reduce((a, b) => a + b, 0),
  volumeSum: volumes.reduce((a, b) => a + b, 0),
  sample: withE.slice(0, 5),
})

// also with mainsail-ish limits
const mainsailish = analyzeGcodeText(gcode, {
  ...profile,
  acceleration: 1000,
  maxPrintSpeed: 300,
  minimumLayerTime: 0,
})
console.log('mainsailish_no_layer_min', {
  h: (mainsailish.estimatedSeconds / 3600).toFixed(2),
  constraints: mainsailish.constraintSeconds,
  ideal: mainsailish.idealSeconds,
})
