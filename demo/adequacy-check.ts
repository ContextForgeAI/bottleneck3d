import { readFileSync } from 'node:fs'
import {
  parseGcodeText,
  evaluateWorkload,
} from '../src/analyzer.ts'
import type { PrinterSettings } from '../src/domain/profile.ts'

const gcode = readFileSync(
  'C:/Users/Developer/Downloads/DragonScalePot (1)_PLA_1h33m.gcode',
  'utf8',
)
const workload = parseGcodeText(gcode)
const filamentArea = Math.PI * (1.75 / 2) ** 2

const reference: PrinterSettings = {
  maxVolumetricFlow: 12,
  maxPrintSpeed: 250,
  acceleration: 5000,
  minimumLayerTime: 5,
  filamentDiameter: 1.75,
}
const virtual: PrinterSettings = {
  maxVolumetricFlow: 19,
  maxPrintSpeed: 250,
  acceleration: 5500,
  minimumLayerTime: 4.5,
  filamentDiameter: 1.75,
}

function physical(segment: (typeof workload.segments)[0], flow: number, maxSpeed: number) {
  const volume = segment.extrusionLength * filamentArea
  const flowSpeed =
    volume > 1e-9 ? (segment.distance * flow) / volume : Number.POSITIVE_INFINITY
  return {
    volume,
    flowSpeed,
    physical: Math.min(maxSpeed, flowSpeed),
    emitted: segment.requestedSpeed,
  }
}

let extrusion = 0
let travel = 0
let flowBoundRef = 0
let speedBoundRef = 0
let scaleSum = 0
let scaleN = 0
let emittedVsFlow12 = 0
let wouldBeFlowLimitedAt12 = 0
const scales: number[] = []

for (const segment of workload.segments) {
  if (segment.extrusionLength > 0) extrusion += 1
  else travel += 1

  const ref = physical(segment, 12, 250)
  const virt = physical(segment, 19, 250)
  if (segment.extrusionLength <= 0) continue

  if (ref.flowSpeed <= 250) flowBoundRef += 1
  else speedBoundRef += 1

  // volumetric rate at emitted F
  const volRate =
    segment.distance > 1e-9
      ? (segment.extrusionLength * filamentArea * segment.requestedSpeed) /
        segment.distance
      : 0
  if (volRate > 12 * 0.98) emittedVsFlow12 += 1
  if (ref.flowSpeed < segment.requestedSpeed) wouldBeFlowLimitedAt12 += 1

  const scale = virt.physical / Math.max(ref.physical, 1e-9)
  scales.push(scale)
  scaleSum += scale
  scaleN += 1
}

scales.sort((a, b) => a - b)
const pct = (p: number) => scales[Math.floor((scales.length - 1) * p)]

const base = evaluateWorkload(workload, reference, 'as_emitted')
const same = evaluateWorkload(workload, reference, 'virtual_limits', reference)
const whatif = evaluateWorkload(workload, virtual, 'virtual_limits', reference)
const onlyFlow = evaluateWorkload(
  workload,
  { ...reference, maxVolumetricFlow: 19 },
  'virtual_limits',
  reference,
)
const onlyAccel = evaluateWorkload(
  workload,
  { ...reference, acceleration: 5500 },
  'virtual_limits',
  reference,
)
const onlyLayer = evaluateWorkload(
  workload,
  { ...reference, minimumLayerTime: 4.5 },
  'virtual_limits',
  reference,
)
const onlySpeed = evaluateWorkload(
  workload,
  { ...reference, maxPrintSpeed: 400 },
  'virtual_limits',
  reference,
)

const orcaMin = 93
const totalVolume = workload.segments.reduce(
  (s, seg) => s + seg.extrusionLength * filamentArea,
  0,
)

console.log(
  JSON.stringify(
    {
      orcaEstimateMin: orcaMin,
      baselineMin: +(base.estimatedSeconds / 60).toFixed(1),
      sameLimitsMin: +(same.estimatedSeconds / 60).toFixed(1),
      whatIfMin: +(whatif.estimatedSeconds / 60).toFixed(1),
      saveMin: +((base.estimatedSeconds - whatif.estimatedSeconds) / 60).toFixed(1),
      onlyFlowSaveMin: +((base.estimatedSeconds - onlyFlow.estimatedSeconds) / 60).toFixed(1),
      onlyAccelSaveMin: +((base.estimatedSeconds - onlyAccel.estimatedSeconds) / 60).toFixed(1),
      onlyLayerSaveMin: +((base.estimatedSeconds - onlyLayer.estimatedSeconds) / 60).toFixed(1),
      onlySpeed400SaveMin: +((base.estimatedSeconds - onlySpeed.estimatedSeconds) / 60).toFixed(
        1,
      ),
      baselineDominant: base.dominant,
      whatIfDominant: whatif.dominant,
      baselineConstraintsMin: {
        hotend: +(base.constraintSeconds.hotend / 60).toFixed(2),
        mechanics: +(base.constraintSeconds.mechanics / 60).toFixed(2),
        cooling: +(base.constraintSeconds.cooling / 60).toFixed(2),
      },
      segments: { extrusion, travel },
      extrusionPhysicalBinderAt12: { flowBoundRef, speedBoundRef },
      emittedNearFlowCeiling12: emittedVsFlow12,
      emittedAboveFlowSpeed12: wouldBeFlowLimitedAt12,
      scaleStats: {
        avg: +(scaleSum / scaleN).toFixed(3),
        p50: +pct(0.5).toFixed(3),
        p90: +pct(0.9).toFixed(3),
        max: +scales[scales.length - 1].toFixed(3),
      },
      totalPlasticCm3: +(totalVolume / 1000).toFixed(1),
      timeIfPureFlow12Min: +(totalVolume / 12 / 60).toFixed(1),
      timeIfPureFlow19Min: +(totalVolume / 19 / 60).toFixed(1),
    },
    null,
    2,
  ),
)
