import type { WorkloadSegment } from './domain/workload.ts'

/**
 * prusa_jerk — PrusaSlicer GCodeProcessor time estimate (Marlin classic jerk).
 * orca_jerk — OrcaSlicer / BambuStudio estimate: vector XYZ jerk, centripetal
 * cap on gentle curves, junction-deviation jerk for Marlin 2.
 * orca_klipper — OrcaSlicer 2.5 Klipper estimator: Marlin trapezoid window plus
 * junction deviation from square_corner_velocity (2.5.0-alpha; main later added
 * plan_klipper, which does not match the time comment these files carry).
 * klipper — full Klipper toolhead.py lookahead (how the printer actually moves).
 */
export type JunctionModel = 'prusa_jerk' | 'orca_jerk' | 'orca_klipper' | 'klipper'

export const junctionModelLabels: Record<JunctionModel, string> = {
  prusa_jerk: 'как оценщик PrusaSlicer',
  orca_jerk: 'как оценщик OrcaSlicer',
  orca_klipper: 'как оценщик OrcaSlicer 2.5 (Klipper)',
  klipper: 'как планировщик Klipper',
}

/** Emulate the estimator of the slicer that produced the file. */
export function junctionModelFor(slicer: string | null, flavor?: string): JunctionModel {
  if (!slicer || !/orca|bambu/i.test(slicer)) return 'prusa_jerk'
  // OrcaSlicer 2.5 replaced its jerk estimate with plan_klipper for Klipper firmware.
  const version = /orcaslicer\s+(\d+)\.(\d+)/i.exec(slicer)
  const modern = version !== null && Number(version[1]) * 100 + Number(version[2]) >= 205
  return modern && flavor?.toLowerCase() === 'klipper' ? 'orca_klipper' : 'orca_jerk'
}

export interface MotionLimits {
  junction: JunctionModel
  flavor: string
  /** Axis caps; 0 means no cap. Klipper applies X/Y as toolhead vector caps. */
  maxSpeedX: number
  maxSpeedY: number
  maxSpeedZ: number
  maxSpeedE: number
  maxAccelX: number
  maxAccelY: number
  maxAccelZ: number
  maxAccelE: number
  /** Clamp for printing-move acceleration (M204 S / SET_VELOCITY_LIMIT ACCEL). */
  maxAccelExtruding: number
  /** Used for extrude-only moves when the file sets no M204 R. */
  retractAcceleration: number
  /** XY jerk / square corner velocity when the file sets none. */
  cornerVelocity: number
  jerkZ: number
  jerkE: number
  /** Marlin 2 junction deviation, used by the Orca estimator when > 0. */
  junctionDeviation: number
  /** Klipper accel_to_decel / accel when the file sets none. */
  accelToDecelRatio: number
  /** Klipper extruder instant_corner_velocity. */
  extruderCornerVelocity: number
}

export const DEFAULT_MOTION_LIMITS: MotionLimits = {
  junction: 'prusa_jerk',
  flavor: '',
  maxSpeedX: 0,
  maxSpeedY: 0,
  maxSpeedZ: 0,
  maxSpeedE: 0,
  maxAccelX: 0,
  maxAccelY: 0,
  maxAccelZ: 0,
  maxAccelE: 0,
  maxAccelExtruding: 0,
  retractAcceleration: 0,
  cornerVelocity: 8,
  jerkZ: 0.4,
  jerkE: 5,
  junctionDeviation: 0,
  accelToDecelRatio: 0.5,
  extruderCornerVelocity: 1,
}

function firstNumber(value: string | undefined): number | null {
  if (value === undefined) return null
  const number = Number(value.split(',')[0].trim())
  return Number.isFinite(number) && number > 0 ? number : null
}

export function motionLimitsFromConfig(
  config: Record<string, string>,
  junction: JunctionModel = DEFAULT_MOTION_LIMITS.junction,
): MotionLimits {
  const pick = (key: string, fallback: number) => firstNumber(config[key]) ?? fallback
  const defaults = DEFAULT_MOTION_LIMITS

  return {
    junction,
    flavor: (config.gcode_flavor ?? '').toLowerCase(),
    maxSpeedX: pick('machine_max_speed_x', defaults.maxSpeedX),
    maxSpeedY: pick('machine_max_speed_y', defaults.maxSpeedY),
    maxSpeedZ: pick('machine_max_speed_z', defaults.maxSpeedZ),
    maxSpeedE: pick('machine_max_speed_e', defaults.maxSpeedE),
    maxAccelX: pick('machine_max_acceleration_x', defaults.maxAccelX),
    maxAccelY: pick('machine_max_acceleration_y', defaults.maxAccelY),
    maxAccelZ: pick('machine_max_acceleration_z', defaults.maxAccelZ),
    maxAccelE: pick('machine_max_acceleration_e', defaults.maxAccelE),
    maxAccelExtruding: pick(
      'machine_max_acceleration_extruding',
      defaults.maxAccelExtruding,
    ),
    retractAcceleration: pick(
      'machine_max_acceleration_retracting',
      defaults.retractAcceleration,
    ),
    cornerVelocity: pick('machine_max_jerk_x', defaults.cornerVelocity),
    jerkZ: pick('machine_max_jerk_z', defaults.jerkZ),
    jerkE: pick('machine_max_jerk_e', defaults.jerkE),
    junctionDeviation: pick('machine_max_junction_deviation', defaults.junctionDeviation),
    accelToDecelRatio: defaults.accelToDecelRatio,
    extruderCornerVelocity: defaults.extruderCornerVelocity,
  }
}

const EPSILON = 1e-9
const SQRT2_MINUS_1 = Math.SQRT2 - 1
const DEFAULT_MINIMUM_CRUISE_RATIO = 0.5

function positiveMin(a: number, b: number): number {
  if (a > 0 && b > 0) return Math.min(a, b)
  return a > 0 ? a : b
}

interface Prepared {
  feed: Float64Array
  accel: Float64Array
  rx: Float64Array
  ry: Float64Array
  rz: Float64Array
  re: Float64Array
}

/** Unit direction, axis speed caps and axis acceleration caps per segment. */
function prepare(
  segments: WorkloadSegment[],
  cruise: Float64Array,
  acceleration: Float64Array,
  limits: MotionLimits,
): Prepared {
  const n = segments.length
  const prepared: Prepared = {
    feed: new Float64Array(n),
    accel: new Float64Array(n),
    rx: new Float64Array(n),
    ry: new Float64Array(n),
    rz: new Float64Array(n),
    re: new Float64Array(n),
  }

  for (let i = 0; i < n; i += 1) {
    const segment = segments[i]
    const inverse = 1 / segment.distance
    const rx = segment.extrudeOnly ? 0 : segment.dx * inverse
    const ry = segment.extrudeOnly ? 0 : segment.dy * inverse
    const rz = segment.extrudeOnly ? 0 : segment.dz * inverse
    const re = segment.de * inverse
    let feed = cruise[i]
    let accel = acceleration[i]
    const klipper = limits.junction === 'klipper'
    const capE = !klipper || segment.de < 0 || (segment.dx === 0 && segment.dy === 0)
    const printing = segment.extrusionLength > 0 && !segment.extrudeOnly

    if (printing && limits.maxAccelExtruding > 0) {
      accel = Math.min(accel, limits.maxAccelExtruding)
    }
    if (klipper && (rx !== 0 || ry !== 0)) {
      const vectorSpeed = positiveMin(limits.maxSpeedX, limits.maxSpeedY)
      const vectorAccel = positiveMin(limits.maxAccelX, limits.maxAccelY)
      if (vectorSpeed > 0) feed = Math.min(feed, vectorSpeed)
      if (vectorAccel > 0) accel = Math.min(accel, vectorAccel)
    } else if (!klipper) {
      if (limits.maxSpeedX > 0 && rx !== 0) {
        feed = Math.min(feed, limits.maxSpeedX / Math.abs(rx))
      }
      if (limits.maxSpeedY > 0 && ry !== 0) {
        feed = Math.min(feed, limits.maxSpeedY / Math.abs(ry))
      }
      if (limits.maxAccelX > 0 && rx !== 0) {
        accel = Math.min(accel, limits.maxAccelX / Math.abs(rx))
      }
      if (limits.maxAccelY > 0 && ry !== 0) {
        accel = Math.min(accel, limits.maxAccelY / Math.abs(ry))
      }
    }
    if (limits.maxSpeedZ > 0 && rz !== 0) {
      feed = Math.min(feed, limits.maxSpeedZ / Math.abs(rz))
    }
    if (capE && limits.maxSpeedE > 0 && re !== 0) {
      feed = Math.min(feed, limits.maxSpeedE / Math.abs(re))
    }
    if (limits.maxAccelZ > 0 && rz !== 0) {
      accel = Math.min(accel, limits.maxAccelZ / Math.abs(rz))
    }
    if (capE && limits.maxAccelE > 0 && re !== 0) {
      accel = Math.min(accel, limits.maxAccelE / Math.abs(re))
    }

    prepared.feed[i] = feed
    prepared.accel[i] = accel
    prepared.rx[i] = rx
    prepared.ry[i] = ry
    prepared.rz[i] = rz
    prepared.re[i] = re
  }

  return prepared
}

/** Orca/Bambu: cap cruise by centripetal acceleration on gentle XY turns. */
function applyCentripetalCap(
  segments: WorkloadSegment[],
  prepared: Prepared,
  acceleration: Float64Array,
): void {
  const { feed, rx, ry } = prepared

  for (let i = 1; i < segments.length; i += 1) {
    const p = i - 1
    const previousXY = Math.hypot(rx[p], ry[p])
    const currentXY = Math.hypot(rx[i], ry[i])
    if (previousXY <= 0 || currentXY <= 0) continue

    const v1x = rx[p] / previousXY
    const v1y = ry[p] / previousXY
    const v2x = rx[i] / currentXY
    const v2y = ry[i] / currentXY
    const normDiff = Math.hypot(v2x - v1x, v2y - v1y)
    if (normDiff >= 0.5 || normDiff <= 0.00001) continue

    const angle = Math.atan2(v1x * v2y - v1y * v2x, v1x * v2x + v1y * v2y)
    const sinHalf = Math.sqrt((1 - Math.cos(angle)) * 0.5)
    const radius = (Math.hypot(segments[i].dx, segments[i].dy) * 0.5) / sinHalf
    feed[i] = Math.min(feed[i], Math.sqrt(acceleration[i] * radius))
  }
}

function axisJerk(vExit: number, vEntry: number): number {
  if (vExit > vEntry) {
    return vEntry > 0 || vExit < 0 ? vExit - vEntry : Math.max(vExit, -vEntry)
  }
  return vEntry < 0 || vExit > 0 ? vEntry - vExit : Math.max(-vExit, vEntry)
}

const SLICER_QUEUE_SIZE = 64
const SLICER_REFRESH_THRESHOLD = SLICER_QUEUE_SIZE * 4

/** TimeBlock::calculate_trapezoid + time() from the slicer estimator. */
function slicerBlockTime(
  distance: number,
  entry: number,
  exit: number,
  cruise: number,
  accel: number,
): number {
  if (distance <= EPSILON || accel <= EPSILON) return 0
  let accelerateDistance = Math.max(0, (cruise * cruise - entry * entry) / (2 * accel))
  const decelerateDistance = Math.max(0, (cruise * cruise - exit * exit) / (2 * accel))
  let cruiseDistance = distance - accelerateDistance - decelerateDistance
  let cruiseFeed = cruise

  if (cruiseDistance < 0) {
    accelerateDistance = Math.min(
      Math.max((2 * accel * distance - entry * entry + exit * exit) / (4 * accel), 0),
      distance,
    )
    cruiseDistance = 0
    cruiseFeed = Math.sqrt(Math.max(0, entry * entry + 2 * accel * accelerateDistance))
  }

  const accelerateTime =
    (Math.sqrt(Math.max(0, entry * entry + 2 * accel * accelerateDistance)) - entry) / accel
  const cruiseTime = cruiseFeed > EPSILON ? cruiseDistance / cruiseFeed : 0
  const decelerateLength = distance - accelerateDistance - cruiseDistance
  const decelerateTime =
    (cruiseFeed -
      Math.sqrt(Math.max(0, cruiseFeed * cruiseFeed - 2 * accel * decelerateLength))) /
    accel
  return accelerateTime + cruiseTime + decelerateTime
}

function xyzeUnit(dx: number, dy: number, dz: number, de: number): [number, number, number, number] {
  const length = Math.hypot(dx, dy, dz, de)
  if (length <= EPSILON) return [0, 0, 0, 0]
  return [dx / length, dy / length, dz / length, de / length]
}

function junctionAcceleration(
  unit: [number, number, number, number],
  blockAccel: number,
  limits: MotionLimits,
): number {
  let accel = blockAccel
  const axes: Array<[number, number]> = [
    [unit[0], limits.maxAccelX],
    [unit[1], limits.maxAccelY],
    [unit[2], limits.maxAccelZ],
    [unit[3], limits.maxAccelE],
  ]
  for (const [component, axisMax] of axes) {
    if (component === 0 || axisMax <= 0) continue
    accel = Math.min(accel, Math.abs(axisMax / component))
  }
  return accel
}

/** Orca 2.5.0-alpha calc_vmax_junction_deviation for Klipper (Marlin JD formula). */
function vmaxJunctionDeviation(
  blockAccel: number,
  cornerVelocity: number,
  prevUnit: [number, number, number, number],
  currUnit: [number, number, number, number],
  hasPrev: boolean,
  cruise: number,
  prevCruise: number,
  limits: MotionLimits,
): number {
  if (cornerVelocity <= 0 || blockAccel <= 0) return -1
  const junctionDeviation = (cornerVelocity * cornerVelocity * SQRT2_MINUS_1) / blockAccel
  if (!hasPrev) return 0
  const cosine =
    -(prevUnit[0] * currUnit[0] +
      prevUnit[1] * currUnit[1] +
      prevUnit[2] * currUnit[2] +
      prevUnit[3] * currUnit[3])
  if (cosine > 0.999999) return 0
  const clamped = Math.max(cosine, -0.999999)
  const sinHalf = Math.sqrt(Math.max(0, 0.5 * (1 - clamped)))
  const junctionVec: [number, number, number, number] = [
    currUnit[0] - prevUnit[0],
    currUnit[1] - prevUnit[1],
    currUnit[2] - prevUnit[2],
    currUnit[3] - prevUnit[3],
  ]
  const junctionNorm = Math.hypot(junctionVec[0], junctionVec[1], junctionVec[2], junctionVec[3])
  const junctionUnit: [number, number, number, number] =
    junctionNorm > 0
      ? [
          junctionVec[0] / junctionNorm,
          junctionVec[1] / junctionNorm,
          junctionVec[2] / junctionNorm,
          junctionVec[3] / junctionNorm,
        ]
      : [0, 0, 0, 0]
  const accel = junctionAcceleration(junctionUnit, blockAccel, limits)
  let vmaxSqr = (accel * junctionDeviation * sinHalf) / (1 - sinHalf)
  vmaxSqr = Math.min(vmaxSqr, cruise * cruise, prevCruise * prevCruise)
  return Math.sqrt(Math.max(0, vmaxSqr))
}

/**
 * Slicer estimators (PrusaSlicer GCodeProcessor and its Orca/Bambu fork): jerk
 * junctions, Marlin planner passes over a 256/64 block window, sync points.
 */
function slicerEstimatorTimes(
  segments: WorkloadSegment[],
  prepared: Prepared,
  limits: MotionLimits,
  acceleration: Float64Array,
): Float64Array {
  const n = segments.length
  const orca = limits.junction === 'orca_jerk' || limits.junction === 'orca_klipper'
  const useKlipperJd = limits.junction === 'orca_klipper'
  if (orca) applyCentripetalCap(segments, prepared, acceleration)

  const { feed, accel, rx, ry, rz, re } = prepared
  const entry = new Float64Array(n)
  const maxEntry = new Float64Array(n)
  const safe = new Float64Array(n)
  const nominalLength = new Uint8Array(n)
  const recalculate = new Uint8Array(n)
  const times = new Float64Array(n)
  const previous = [0, 0, 0, 0]
  const current = [0, 0, 0, 0]
  const jerks = [0, 0, limits.jerkZ, limits.jerkE]
  const useJunctionDeviation =
    orca && limits.flavor === 'marlin2' && limits.junctionDeviation > 0
  let previousFeed = 0
  let previousSafe = 0
  let previousDirection = [0, 0, 0]
  let previousUnit: [number, number, number, number] = [0, 0, 0, 0]
  let windowStart = 0

  const calculate = (from: number, to: number, keep: number) => {
    if (to - from < 2 && keep) return from

    const reverse = () => {
      for (let i = to - 1; i > from; i -= 1) {
        const c = i - 1
        if (orca) {
          if (entry[c] === maxEntry[c] && !recalculate[i]) continue
          const next = nominalLength[c]
            ? maxEntry[c]
            : Math.min(maxEntry[c], Math.sqrt(entry[i] ** 2 + 2 * accel[c] * segments[c].distance))
          if (entry[c] !== next) {
            entry[c] = next
            recalculate[c] = 1
          }
        } else if (entry[c] !== maxEntry[c]) {
          entry[c] =
            !nominalLength[c] && maxEntry[c] > entry[i]
              ? Math.min(
                  maxEntry[c],
                  Math.sqrt(entry[i] ** 2 + 2 * accel[c] * segments[c].distance),
                )
              : maxEntry[c]
          recalculate[c] = 1
        }
      }
    }
    const forward = () => {
      for (let i = from; i + 1 < to; i += 1) {
        if (nominalLength[i] || entry[i] >= entry[i + 1]) continue
        const reachable = Math.sqrt(entry[i] ** 2 + 2 * accel[i] * segments[i].distance)
        if (reachable < entry[i + 1]) {
          entry[i + 1] = reachable
          recalculate[i + 1] = 1
        }
      }
    }

    if (orca) {
      reverse()
      forward()
    } else {
      forward()
      reverse()
    }

    const processUntil = to - keep
    for (let i = from; i < processUntil; i += 1) {
      const exit = i + 1 < to ? entry[i + 1] : safe[i]
      times[i] = slicerBlockTime(segments[i].distance, entry[i], exit, feed[i], accel[i])
    }
    for (let i = from; i + 1 < to; i += 1) {
      if (recalculate[i] || recalculate[i + 1]) recalculate[i] = 0
    }
    if (to > from) recalculate[to - 1] = 0
    return processUntil
  }

  for (let i = 0; i < n; i += 1) {
    if (segments[i].syncBefore) windowStart = calculate(windowStart, i, 0)

    const f = feed[i]
    const a = accel[i]
    const direction = [rx[i], ry[i], rz[i]]
    const currUnit = xyzeUnit(segments[i].dx, segments[i].dy, segments[i].dz, segments[i].de)
    let cornerVelocity = segments[i].cornerVelocity || limits.cornerVelocity
    let jerkZ = limits.jerkZ
    let jerkE = limits.jerkE
    if (useJunctionDeviation) {
      const jdJerk = Math.sqrt(limits.junctionDeviation * acceleration[i] * 2.5)
      cornerVelocity = jdJerk
      jerkZ = jdJerk
      jerkE = jdJerk
    }
    jerks[0] = cornerVelocity
    jerks[1] = cornerVelocity
    jerks[2] = jerkZ
    jerks[3] = jerkE
    current[0] = f * rx[i]
    current[1] = f * ry[i]
    current[2] = f * rz[i]
    current[3] = f * re[i]

    const hasPrev = i > windowStart && previousFeed > 1e-4
    if (useKlipperJd) {
      const vmax = vmaxJunctionDeviation(
        a,
        cornerVelocity,
        previousUnit,
        currUnit,
        hasPrev,
        f,
        previousFeed,
        limits,
      )
      const safeFeed = 0
      const junction = vmax >= 0 ? vmax : 0
      const allowable = Math.sqrt(2 * a * segments[i].distance)
      entry[i] = Math.min(junction, allowable)
      maxEntry[i] = junction
      nominalLength[i] = f <= allowable ? 1 : 0
      safe[i] = safeFeed
      recalculate[i] = 1
      previousUnit = currUnit
      previousFeed = f
      previousSafe = safeFeed
      previousDirection = direction
      if (i + 1 - windowStart > SLICER_REFRESH_THRESHOLD) {
        windowStart = calculate(windowStart, i + 1, SLICER_QUEUE_SIZE)
      }
      continue
    }

    let safeFeed = f
    for (let axis = 0; axis < 4; axis += 1) {
      if (Math.abs(current[axis]) > jerks[axis]) safeFeed = Math.min(safeFeed, jerks[axis])
    }

    let junction = safeFeed
    if (hasPrev) {
      const previousLarger = previousFeed > f
      const smallerFactor = previousLarger ? f / previousFeed : previousFeed / f
      junction = previousLarger ? f : previousFeed
      let factor = 1
      let limited = false

      if (orca) {
        const scale = previousLarger ? smallerFactor : 1
        const jerkVector = [0, 1, 2].map((axis) =>
          Math.abs(f * direction[axis] - previousFeed * previousDirection[axis] * scale),
        )
        for (let axis = 0; axis < 3; axis += 1) {
          if (jerkVector[axis] > jerks[axis]) {
            factor *= jerks[axis] / jerkVector[axis]
            for (let k = 0; k < 3; k += 1) jerkVector[k] *= factor
            limited = true
          }
        }
      }

      for (let axis = orca ? 3 : 0; axis < 4; axis += 1) {
        let vExit = previous[axis]
        let vEntry = current[axis]
        if (previousLarger) vExit *= smallerFactor
        if (limited) {
          vExit *= factor
          vEntry *= factor
        }
        const jerk = axisJerk(vExit, vEntry)
        if (jerk > jerks[axis]) {
          factor *= jerks[axis] / jerk
          limited = true
        }
      }

      if (limited) junction *= factor
      const threshold = junction * 0.99
      if (previousSafe > threshold && safeFeed > threshold) junction = safeFeed
    }

    const allowable = Math.sqrt(safeFeed * safeFeed + 2 * a * segments[i].distance)
    entry[i] = Math.min(junction, allowable)
    maxEntry[i] = junction
    nominalLength[i] = f <= allowable ? 1 : 0
    safe[i] = safeFeed
    recalculate[i] = 1
    for (let axis = 0; axis < 4; axis += 1) previous[axis] = current[axis]
    previousFeed = f
    previousSafe = safeFeed
    previousDirection = direction

    if (i + 1 - windowStart > SLICER_REFRESH_THRESHOLD) {
      windowStart = calculate(windowStart, i + 1, SLICER_QUEUE_SIZE)
    }
  }

  calculate(windowStart, n, 0)
  return times
}

function klipperTimes(
  segments: WorkloadSegment[],
  prepared: Prepared,
  limits: MotionLimits,
): Float64Array {
  const n = segments.length
  const { feed, accel, rx, ry, rz } = prepared
  const maxCruiseV2 = new Float64Array(n)
  const maxStartV2 = new Float64Array(n)
  const maxSmoothedV2 = new Float64Array(n)
  const deltaV2 = new Float64Array(n)
  const smoothDeltaV2 = new Float64Array(n)
  const extrusionRatio = new Float64Array(n)
  const deviationV2 = new Float64Array(n)
  const sqrt2Minus1 = Math.SQRT2 - 1

  for (let i = 0; i < n; i += 1) {
    const segment = segments[i]
    const a = accel[i]
    const liveAccel = liveToolheadAccel(segment, a)
    const cruiseAccel = cruiseAccelerationOf(segment, liveAccel)
    const cornerVelocity = segment.cornerVelocity || limits.cornerVelocity

    maxCruiseV2[i] = feed[i] * feed[i]
    deltaV2[i] = 2 * segment.distance * a
    smoothDeltaV2[i] = 2 * segment.distance * Math.min(a, Math.max(0, cruiseAccel))
    extrusionRatio[i] = segment.extrudeOnly ? 0 : segment.de / segment.distance
    // R_jd * junction_deviation * accel, with junction_deviation = scv²(√2−1)/accel.
    deviationV2[i] = cornerVelocity * cornerVelocity * sqrt2Minus1

    const p = i - 1
    if (p < 0 || segment.extrudeOnly || segments[p].extrudeOnly) continue

    let maxStart = Math.min(
      maxCruiseV2[i],
      maxCruiseV2[p],
      maxStartV2[p] + deltaV2[p],
    )
    const extrusionDiff = Math.abs(extrusionRatio[i] - extrusionRatio[p])
    if (extrusionDiff > EPSILON) {
      maxStart = Math.min(
        maxStart,
        (limits.extruderCornerVelocity / extrusionDiff) ** 2,
      )
    }

    const cosTheta = -(rx[i] * rx[p] + ry[i] * ry[p] + rz[i] * rz[p])
    const sinHalf = Math.sqrt(Math.max(0.5 * (1 - cosTheta), 0))
    const cosHalf = Math.sqrt(Math.max(0.5 * (1 + cosTheta), 0))
    const oneMinusSinHalf = 1 - sinHalf
    if (oneMinusSinHalf > 0 && cosHalf > 0) {
      const radius = sinHalf / oneMinusSinHalf
      const quarterTanHalf = (0.25 * sinHalf) / cosHalf
      maxStart = Math.min(
        maxStart,
        radius * deviationV2[i],
        radius * deviationV2[p],
        deltaV2[i] * quarterTanHalf,
        deltaV2[p] * quarterTanHalf,
      )
    }

    maxStartV2[i] = maxStart
    maxSmoothedV2[i] = Math.min(maxStart, maxSmoothedV2[p] + smoothDeltaV2[p])
  }

  const startV2 = new Float64Array(n)
  const cruiseV2 = new Float64Array(n)
  const endV2 = new Float64Array(n)
  const delayedStart = new Float64Array(n)
  const delayedEnd = new Float64Array(n)
  const delayed: number[] = []
  let nextEndV2 = 0
  let nextSmoothedV2 = 0
  let peakCruiseV2 = 0

  const setJunction = (index: number, start: number, cruise: number, end: number) => {
    startV2[index] = start
    cruiseV2[index] = cruise
    endV2[index] = end
  }

  for (let i = n - 1; i >= 0; i -= 1) {
    const reachableStartV2 = nextEndV2 + deltaV2[i]
    const start = Math.min(maxStartV2[i], reachableStartV2)
    const reachableSmoothedV2 = nextSmoothedV2 + smoothDeltaV2[i]
    const smoothed = Math.min(maxSmoothedV2[i], reachableSmoothedV2)

    if (smoothed < reachableSmoothedV2) {
      if (smoothed + smoothDeltaV2[i] > nextSmoothedV2 || delayed.length) {
        peakCruiseV2 = Math.min(maxCruiseV2[i], (smoothed + reachableSmoothedV2) * 0.5)
        let cruise = peakCruiseV2
        for (let k = delayed.length - 1; k >= 0; k -= 1) {
          const index = delayed[k]
          cruise = Math.min(cruise, delayedStart[index])
          setJunction(
            index,
            Math.min(delayedStart[index], cruise),
            cruise,
            Math.min(delayedEnd[index], cruise),
          )
        }
        delayed.length = 0
      }
      const cruise = Math.min(
        (start + reachableStartV2) * 0.5,
        maxCruiseV2[i],
        peakCruiseV2,
      )
      setJunction(i, Math.min(start, cruise), cruise, Math.min(nextEndV2, cruise))
    } else {
      delayed.push(i)
      delayedStart[i] = start
      delayedEnd[i] = nextEndV2
    }

    nextEndV2 = start
    nextSmoothedV2 = smoothed
  }

  for (const index of delayed) {
    const cruise = Math.min(maxCruiseV2[index], delayedStart[index] + deltaV2[index])
    setJunction(index, delayedStart[index], cruise, Math.min(delayedEnd[index], cruise))
  }

  const times = new Float64Array(n)
  for (let i = 0; i < n; i += 1) {
    const a = accel[i]
    const vs = Math.sqrt(startV2[i])
    const vc = Math.sqrt(cruiseV2[i])
    const ve = Math.sqrt(endV2[i])
    if (vc <= EPSILON) continue
    const accelDistance = (cruiseV2[i] - startV2[i]) / (2 * a)
    const decelDistance = (cruiseV2[i] - endV2[i]) / (2 * a)
    const cruiseDistance = Math.max(
      0,
      segments[i].distance - accelDistance - decelDistance,
    )
    times[i] = (vc - vs) / a + (vc - ve) / a + cruiseDistance / vc
  }
  return times
}

function liveToolheadAccel(segment: WorkloadSegment, moveAccel: number): number {
  if (segment.extrudeOnly) {
    return segment.toolheadAcceleration > 0 ? segment.toolheadAcceleration : moveAccel
  }
  return moveAccel
}

function cruiseAccelerationOf(segment: WorkloadSegment, liveAccel: number): number {
  if (liveAccel <= 0) return 0
  if (segment.minimumCruiseRatio >= 0 && segment.minimumCruiseRatio < 1) {
    return liveAccel * (1 - segment.minimumCruiseRatio)
  }
  if (segment.accelToDecel > 0) {
    const origLive =
      segment.toolheadAcceleration > 0 ? segment.toolheadAcceleration : segment.acceleration
    const scaled =
      origLive > 0 ? segment.accelToDecel * (liveAccel / origLive) : segment.accelToDecel
    return Math.min(liveAccel, scaled)
  }
  return liveAccel * (1 - DEFAULT_MINIMUM_CRUISE_RATIO)
}

/** Per-segment motion time with lookahead across neighbouring segments. */
export function planSegmentTimes(
  segments: WorkloadSegment[],
  cruise: Float64Array,
  acceleration: Float64Array,
  limits: MotionLimits,
): Float64Array {
  const prepared = prepare(segments, cruise, acceleration, limits)
  return limits.junction === 'klipper'
    ? klipperTimes(segments, prepared, limits)
    : slicerEstimatorTimes(segments, prepared, limits, acceleration)
}
