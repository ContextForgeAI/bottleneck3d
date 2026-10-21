/**
 * G2/G3 discretization matching OrcaSlicer 2.5.0-alpha GCodeProcessor::process_G2_G3
 * (and PrusaSlicer 2.6 when that slicer produced the file).
 *
 * Orca: https://raw.githubusercontent.com/SoftFever/OrcaSlicer/v2.5.0-alpha/src/libslic3r/GCode/GCodeProcessor.cpp
 * ArcWelder: ArcWelder.hpp arc_center / arc_discretization_steps
 * Prusa 2.6: MM_PER_ARC_SEGMENT = 1.0, I/J only in upstream; R is still accepted here.
 */

export type ArcDiscretization = 'orca_arcwelder' | 'orca_marlin' | 'prusa'

export interface ArcPoint {
  x: number
  y: number
  z: number
  e: number
}

/** Slic3r libslic3r.h EPSILON. */
const SLIC3R_EPSILON = 1e-4
const TRAVEL_MIN = 0.001
const GCODE_ARC_TOLERANCE = 0.0125
const MM_PER_ARC_SEGMENT = 1.0
const N_ARC_CORRECTION = 25
const INCHES_TO_MM = 25.4
const MAX_ARC_DEVIATION = 0.02
const MIN_ARC_SEGMENTS_PER_SEC = 50
const MIN_ARC_SEGMENT_MM = 0.1
const MAX_ARC_SEGMENT_MM = 2.0

export function arcDiscretizationFor(
  slicer: string | null,
  flavor?: string,
): ArcDiscretization {
  if (slicer && /prusa\s*slicer/i.test(slicer) && !/orca/i.test(slicer)) return 'prusa'
  const code = (flavor ?? '').toLowerCase()
  if (code === 'marlin2' || code === 'marlinfirmware') return 'orca_marlin'
  return 'orca_arcwelder'
}

export function peekArcDiscretization(text: string): ArcDiscretization {
  const head = text.slice(0, 16_384)
  const tail = text.length > 16_384 ? text.slice(-131_072) : ''
  const snippet = head + '\n' + tail
  const generated = /;\s*generated (?:by|with)\s+(.+?)(?:\s+on\s+\d.*)?$/im.exec(snippet)
  const slicer = generated ? generated[1].trim() : null
  const flavor = /;\s*gcode_flavor\s*=\s*(\S+)/i.exec(snippet)?.[1]
  return arcDiscretizationFor(slicer, flavor)
}

/** ArcWelder.hpp arc_center: +R shorter arc, −R longer; is_ccw = !clockwise. */
export function arcCenter(
  start: { x: number; y: number },
  end: { x: number; y: number },
  radius: number,
  isCcw: boolean,
): { x: number; y: number } {
  const vx = end.x - start.x
  const vy = end.y - start.y
  const q2 = vx * vx + vy * vy
  const t2 = (radius * radius) / q2 - 0.25
  const t = t2 > 0 ? Math.sqrt(t2) : 0
  const midX = 0.5 * (start.x + end.x)
  const midY = 0.5 * (start.y + end.y)
  const vpx = -vy * t
  const vpy = vx * t
  return (radius > 0) === isCcw ? { x: midX + vpx, y: midY + vpy } : { x: midX - vpx, y: midY - vpy }
}

/** ArcWelder.hpp arc_discretization_steps. */
export function arcDiscretizationSteps(radius: number, angle: number, deviation: number): number {
  const d = radius - deviation
  if (d < SLIC3R_EPSILON) {
    if (
      angle < Math.PI ||
      radius * (1 + Math.cos(Math.PI - 0.5 * angle)) < deviation
    ) {
      return 1
    }
    return 2
  }
  return Math.ceil(angle / (2 * Math.acos(d / radius)))
}

export function discretizeArc(args: {
  start: ArcPoint
  end: ArcPoint
  i: number | undefined
  j: number | undefined
  r: number | undefined
  clockwise: boolean
  feedrateMmS: number
  imperial: boolean
  policy: ArcDiscretization
}): ArcPoint[] | null {
  const { start, end, clockwise, feedrateMmS, imperial, policy } = args
  let relX: number
  let relY: number

  if (args.r !== undefined && args.r !== 0) {
    const center = arcCenter(start, end, args.r, !clockwise)
    relX = center.x - start.x
    relY = center.y - start.y
  } else if (args.i !== undefined || args.j !== undefined) {
    relX = args.i ?? 0
    relY = args.j ?? 0
  } else {
    return null
  }

  if (imperial) {
    relX *= INCHES_TO_MM
    relY *= INCHES_TO_MM
  }

  const cx = start.x + relX
  const cy = start.y + relY
  const startRadius = Math.hypot(start.x - cx, start.y - cy, start.z - start.z)
  const dx = end.x - start.x
  const dy = end.y - start.y
  const dz = end.z - start.z
  const extrusion = end.e - start.e
  const fullCircle = Math.abs(dx) < SLIC3R_EPSILON && Math.abs(dy) < SLIC3R_EPSILON

  const relStartX = start.x - cx
  const relStartY = start.y - cy
  const relEndX = end.x - cx
  const relEndY = end.y - cy

  let angle: number
  if (fullCircle) {
    angle = 2 * Math.PI
  } else {
    angle = Math.atan2(
      relStartX * relEndY - relStartY * relEndX,
      relStartX * relEndX + relStartY * relEndY,
    )
    if (angle < 0) angle += 2 * Math.PI
    if (clockwise) angle -= 2 * Math.PI
  }

  const length = angle * startRadius
  const travelLength = Math.sqrt(length * length + dz * dz)
  if (travelLength < TRAVEL_MIN) return null

  const absAngle = Math.abs(angle)
  let segments: number
  if (policy === 'prusa') {
    segments = Math.max(Math.floor(travelLength / MM_PER_ARC_SEGMENT), 1)
  } else if (policy === 'orca_marlin') {
    const radiusMm = Math.hypot(relX, relY)
    const segmentMm = Math.min(
      Math.max(
        Math.min(
          Math.sqrt(8 * radiusMm * MAX_ARC_DEVIATION),
          feedrateMmS * (1 / MIN_ARC_SEGMENTS_PER_SEC),
        ),
        MIN_ARC_SEGMENT_MM,
      ),
      MAX_ARC_SEGMENT_MM,
    )
    const flatMm = radiusMm * absAngle
    segments = Math.max(Math.trunc(flatMm / segmentMm + 0.8), 1)
  } else {
    segments = Math.max(arcDiscretizationSteps(startRadius, absAngle, GCODE_ARC_TOLERANCE), 1)
  }

  const inv = 1 / segments
  const theta = angle * inv
  const zPer = dz * inv
  const ePer = extrusion * inv
  const points: ArcPoint[] = []

  if (policy === 'orca_marlin') {
    let rx = -relX
    let ry = -relY
    let z = start.z
    let e = start.e
    const cosT = Math.cos(theta)
    const sinT = Math.sin(theta)
    let recalc = N_ARC_CORRECTION
    for (let i = 1; i < segments; i += 1) {
      if (--recalc) {
        const newY = rx * sinT + ry * cosT
        rx = rx * cosT - ry * sinT
        ry = newY
      } else {
        recalc = N_ARC_CORRECTION
        const ti = i * theta
        const cosTi = Math.cos(ti)
        const sinTi = Math.sin(ti)
        rx = -relX * cosTi + relY * sinTi
        ry = -relX * sinTi - relY * cosTi
      }
      z += zPer
      e += ePer
      points.push({ x: cx + rx, y: cy + ry, z, e })
    }
  } else {
    const sqTheta = theta * theta
    const cosT = 1 - 0.5 * sqTheta
    const sinT = policy === 'prusa' ? theta : theta - (sqTheta * theta) / 6
    let relXNow = relStartX
    let relYNow = relStartY
    let z = start.z
    let e = start.e
    let count = policy === 'prusa' ? 0 : N_ARC_CORRECTION
    for (let i = 1; i < segments; i += 1) {
      if (policy === 'prusa') {
        if (count < N_ARC_CORRECTION) {
          const axis = relXNow * sinT + relYNow * cosT
          relXNow = relXNow * cosT - relYNow * sinT
          relYNow = axis
          count += 1
        } else {
          const ti = i * theta
          const cosTi = Math.cos(ti)
          const sinTi = Math.sin(ti)
          relXNow = -relX * cosTi + relY * sinTi
          relYNow = -relX * sinTi - relY * cosTi
          count = 0
        }
      } else if (count-- === 0) {
        const ti = i * theta
        const cosTi = Math.cos(ti)
        const sinTi = Math.sin(ti)
        relXNow = -relX * cosTi + relY * sinTi
        relYNow = -relX * sinTi - relY * cosTi
        count = N_ARC_CORRECTION
      } else {
        const axis = relXNow * sinT + relYNow * cosT
        relXNow = relXNow * cosT - relYNow * sinT
        relYNow = axis
      }
      z += zPer
      e += ePer
      points.push({ x: cx + relXNow, y: cy + relYNow, z, e })
    }
  }

  points.push({ ...end })
  return points
}
