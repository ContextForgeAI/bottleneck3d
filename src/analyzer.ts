import type { PrinterSettings } from './domain/profile'
import type {
  AnalysisResult,
  AnalysisWarning,
  BottleneckKind,
  EnvelopeBreach,
  FlowStats,
  LayerTime,
  RoleKind,
  RoleTime,
} from './domain/result'
import type { SimulationMode } from './domain/simulation-mode'
import {
  emittedGcodeIntent,
  type PrintWorkload,
  type WorkloadSegment,
} from './domain/workload.ts'
import {
  discretizeArc,
  peekArcDiscretization,
  type ArcDiscretization,
} from './gcode-arcs.ts'
import {
  junctionModelFor,
  motionLimitsFromConfig,
  planSegmentTimes,
  type JunctionModel,
} from './motion-planner.ts'
import {
  roleTargetSpeed,
  slicerSlowDownMinSpeed,
  SlicerMetadataCollector,
} from './slicer-metadata.ts'

interface Position {
  x: number
  y: number
  z: number
  e: number
}

interface LayerStats {
  seconds: number
  idealSeconds: number
  z: number
  hasExtrusion: boolean
  extrusionSeconds: number
  extrusionDistance: number
}

const EPSILON = 1e-9
/** Ignore Z-hop / micro jitter when slicer layer markers are absent. */
const LAYER_Z_EPSILON = 0.05
/** Orca/Prusa/Cura ";TYPE:Outer wall", Bambu/Orca "; FEATURE: Outer wall". */
const ROLE_COMMENT = /^;\s*(?:TYPE|FEATURE)\s*:\s*(.+)$/i

function positive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function parameters(line: string): Map<string, number> {
  const result = new Map<string, number>()
  const pattern = /([A-Za-z])\s*(-?(?:\d+\.?\d*|\.\d+))/g
  let match: RegExpExecArray | null

  while ((match = pattern.exec(line)) !== null) {
    result.set(match[1].toUpperCase(), Number(match[2]))
  }

  return result
}

function isLayerChangeComment(line: string): boolean {
  const trimmed = line.trim()
  return (
    /^;+\s*LAYER_CHANGE\b/i.test(trimmed) ||
    /^;+\s*LAYER:\s*\d+/i.test(trimmed) ||
    /^;+\s*CHANGE LAYER\b/i.test(trimmed)
  )
}

export class GcodeParser {
  private readonly arcPolicy: ArcDiscretization
  private position: Position = { x: 0, y: 0, z: 0, e: 0 }
  private feedRate = 0
  private absolutePosition = true
  private absoluteExtrusion = true
  private lineCount = 0
  private moveCount = 0
  private extrusionMoveCount = 0
  private arcCount = 0
  private imperialUnits = false
  private layerIndex = 0
  private layerMarkerCount = 0
  private usedLayerMarkers = false
  private currentLayerZ: number | null = null
  private readonly segments: WorkloadSegment[] = []
  private readonly accelerations = new Set<number>()
  /** Extrusion distance per emitted print acceleration. */
  private readonly accelerationUse = new Map<number, number>()
  private readonly metadata = new SlicerMetadataCollector()
  private printAcceleration = 0
  private travelAcceleration = 0
  private retractAcceleration = 0
  private cornerVelocity = 0
  private accelToDecel = 0
  private minimumCruiseRatio = -1
  private klipperCommands = false
  private speedFactor = 1
  private dwellSeconds = 0
  private pendingSync = false
  private readonly roles: string[] = []
  private readonly roleIndex = new Map<string, number>()
  private role = -1

  constructor(arcPolicy: ArcDiscretization = 'orca_arcwelder') {
    this.arcPolicy = arcPolicy
  }

  push(line: string): void {
    this.lineCount += 1

    if (isLayerChangeComment(line)) {
      this.usedLayerMarkers = true
      this.layerMarkerCount += 1
      this.layerIndex = Math.max(0, this.layerMarkerCount - 1)
      return
    }

    const trimmed = line.trim()
    if (trimmed.startsWith(';')) {
      const role = ROLE_COMMENT.exec(trimmed)
      if (role) {
        this.setRole(role[1].trim())
        return
      }
      this.metadata.push(trimmed)
      return
    }

    const commandText = line.split(';', 1)[0].trim()
    if (!commandText) return

    if (/^SET_VELOCITY_LIMIT\b/i.test(commandText)) {
      this.setVelocityLimit(commandText)
      return
    }
    if (/^EXCLUDE_OBJECT_DEFINE\b/i.test(commandText)) {
      this.metadata.pushObjectDefinition(commandText)
      return
    }

    const values = parameters(commandText)
    const command = commandText.match(/^\s*([A-Za-z]\d+)/)?.[1].toUpperCase()

    switch (command) {
      case 'G0':
      case 'G1':
        this.processMove(values)
        break
      case 'G2':
      case 'G3':
        this.processArc(values, command === 'G2')
        break
      case 'G20':
        this.imperialUnits = true
        break
      case 'G21':
        this.imperialUnits = false
        break
      case 'G90':
        this.absolutePosition = true
        break
      case 'G91':
        this.absolutePosition = false
        break
      case 'G92':
        if (!values.has('E')) this.pendingSync = true
        this.setPosition(values)
        break
      case 'M400':
        this.pendingSync = true
        break
      case 'M82':
        this.absoluteExtrusion = true
        break
      case 'M83':
        this.absoluteExtrusion = false
        break
      case 'M204': {
        if (this.klipperCommands) {
          let value = values.get('S')
          if (value === undefined) {
            const print = values.get('P')
            const travel = values.get('T')
            if (print === undefined || travel === undefined) break
            value = Math.min(print, travel)
          }
          if (value > 0) {
            this.printAcceleration = this.recordAcceleration(value)
            this.travelAcceleration = this.printAcceleration
          }
          break
        }
        const both = values.get('S')
        const print = values.get('P') ?? both
        const travel = values.get('T') ?? both
        const retract = values.get('R')
        if (print !== undefined) this.printAcceleration = this.recordAcceleration(print)
        if (travel !== undefined) this.travelAcceleration = this.recordAcceleration(travel)
        if (retract !== undefined) this.retractAcceleration = Math.max(0, retract)
        break
      }
      case 'M205': {
        const jerk = values.get('X') ?? values.get('Y')
        if (jerk !== undefined && jerk > 0) this.cornerVelocity = jerk
        break
      }
      case 'M220': {
        const factor = values.get('S')
        if (factor !== undefined && factor > 0) this.speedFactor = factor / 100
        break
      }
      case 'G4': {
        const milliseconds = values.get('P')
        const seconds = values.get('S')
        this.dwellSeconds += Math.max(0, seconds ?? (milliseconds ?? 0) / 1000)
        this.pendingSync = true
        break
      }
    }
  }

  private setRole(name: string): void {
    let index = this.roleIndex.get(name)
    if (index === undefined) {
      index = this.roles.length
      this.roles.push(name)
      this.roleIndex.set(name, index)
    }
    this.role = index
  }

  private recordAcceleration(value: number): number {
    if (!Number.isFinite(value) || value <= 0) return 0
    this.accelerations.add(value)
    return value
  }

  private setVelocityLimit(commandText: string): void {
    this.klipperCommands = true
    const read = (key: string) => {
      const match = new RegExp(`\\b${key}=(\\d+(?:\\.\\d+)?)`, 'i').exec(commandText)
      return match ? Number(match[1]) : undefined
    }
    const accel = read('ACCEL')
    const cornerVelocity = read('SQUARE_CORNER_VELOCITY')
    const accelToDecel = read('ACCEL_TO_DECEL')
    const cruiseRatio = read('MINIMUM_CRUISE_RATIO')

    if (accel !== undefined) {
      this.printAcceleration = this.recordAcceleration(accel)
      this.travelAcceleration = this.printAcceleration
    }
    if (cornerVelocity !== undefined) this.cornerVelocity = cornerVelocity
    // Klipper 0.13: a line with both ACCEL_TO_DECEL and MINIMUM_CRUISE_RATIO
    // is planned with the cruise ratio (Orca process_SET_VELOCITY_LIMIT).
    if (cruiseRatio !== undefined && cruiseRatio >= 0 && cruiseRatio < 1) {
      this.minimumCruiseRatio = cruiseRatio
      this.accelToDecel = 0
    } else if (accelToDecel !== undefined && accelToDecel > 0) {
      this.accelToDecel = accelToDecel
      this.minimumCruiseRatio = -1
    }
  }

  private referenceAcceleration(): number | null {
    const configured = Number(
      (this.metadata.peekConfig('default_acceleration') ?? '').split(',')[0],
    )
    if (Number.isFinite(configured) && configured > 0) return configured

    let best: number | null = null
    let bestDistance = -1
    for (const [accel, distance] of this.accelerationUse) {
      if (distance > bestDistance) {
        best = accel
        bestDistance = distance
      }
    }
    return best
  }

  finish(mode: SimulationMode = 'emitted_gcode_audit'): PrintWorkload {
    return {
      mode,
      intent: emittedGcodeIntent,
      lineCount: this.lineCount,
      moveCount: this.moveCount,
      extrusionMoveCount: this.extrusionMoveCount,
      arcCount: this.arcCount,
      imperialUnits: this.imperialUnits,
      emittedAccelerations: [...this.accelerations].sort((a, b) => a - b),
      referenceAcceleration: this.referenceAcceleration(),
      dwellSeconds: this.dwellSeconds,
      slicer: this.metadata.finish(),
      roles: [...this.roles],
      segments: this.segments,
    }
  }

  private nextPosition(values: Map<string, number>): Position {
    const next = { ...this.position }
    for (const axis of ['X', 'Y', 'Z'] as const) {
      const value = values.get(axis)
      if (value === undefined) continue
      const key = axis.toLowerCase() as 'x' | 'y' | 'z'
      next[key] = this.absolutePosition ? value : this.position[key] + value
    }
    const extrusion = values.get('E')
    if (extrusion !== undefined) {
      next.e = this.absoluteExtrusion ? extrusion : this.position.e + extrusion
    }
    return next
  }

  private processMove(values: Map<string, number>): void {
    if (values.has('F')) this.feedRate = values.get('F') ?? this.feedRate
    this.emitSegment(this.nextPosition(values))
  }

  private processArc(values: Map<string, number>, clockwise: boolean): void {
    this.arcCount += 1
    if (values.has('F')) this.feedRate = values.get('F') ?? this.feedRate
    const start = { ...this.position }
    const end = this.nextPosition(values)
    const points = discretizeArc({
      start,
      end,
      i: values.get('I'),
      j: values.get('J'),
      r: values.get('R'),
      clockwise,
      feedrateMmS: (this.feedRate / 60) * this.speedFactor,
      imperial: this.imperialUnits,
      policy: this.arcPolicy,
    })
    if (!points) {
      this.emitSegment(end)
      return
    }
    for (const point of points) this.emitSegment(point)
  }

  private emitSegment(next: Position): void {
    const dx = next.x - this.position.x
    const dy = next.y - this.position.y
    const dz = next.z - this.position.z
    const deltaE = next.e - this.position.e
    const xyzDistance = Math.hypot(dx, dy, dz)
    const extrudeOnly = xyzDistance <= EPSILON && Math.abs(deltaE) > EPSILON
    const distance = extrudeOnly ? Math.abs(deltaE) : xyzDistance
    const requestedSpeed = (this.feedRate / 60) * this.speedFactor
    this.position = next

    if (distance <= EPSILON || requestedSpeed <= EPSILON) return

    const extrusionLength = extrudeOnly ? 0 : Math.max(0, deltaE)
    const acceleration = extrudeOnly
      ? this.retractAcceleration
      : extrusionLength > 0
        ? this.printAcceleration
        : this.travelAcceleration
    const toolheadAcceleration = this.printAcceleration
    if (extrusionLength > 0 && this.printAcceleration > 0) {
      this.accelerationUse.set(
        this.printAcceleration,
        (this.accelerationUse.get(this.printAcceleration) ?? 0) + distance,
      )
    }
    if (!this.usedLayerMarkers && extrusionLength > 0) {
      if (this.currentLayerZ === null) {
        this.currentLayerZ = next.z
      } else if (Math.abs(next.z - this.currentLayerZ) > LAYER_Z_EPSILON) {
        this.layerIndex += 1
        this.currentLayerZ = next.z
      }
    }

    this.moveCount += 1
    this.segments.push({
      distance,
      requestedSpeed,
      extrusionLength,
      z: next.z,
      layerIndex: this.layerIndex,
      dx,
      dy,
      dz,
      de: deltaE,
      extrudeOnly,
      acceleration,
      toolheadAcceleration,
      cornerVelocity: this.cornerVelocity,
      accelToDecel: this.accelToDecel,
      minimumCruiseRatio: this.minimumCruiseRatio,
      syncBefore: this.pendingSync,
      role: this.role,
    })
    this.pendingSync = false

    if (extrusionLength > 0) {
      this.extrusionMoveCount += 1
    }
  }

  private setPosition(values: Map<string, number>): void {
    for (const axis of ['X', 'Y', 'Z', 'E'] as const) {
      const value = values.get(axis)
      if (value !== undefined) {
        const key = axis.toLowerCase() as keyof Position
        this.position[key] = value
      }
    }
  }
}

function normalizedSettings(profile: PrinterSettings): PrinterSettings {
  return {
    maxVolumetricFlow: positive(profile.maxVolumetricFlow, 12),
    maxPrintSpeed: positive(profile.maxPrintSpeed, 250),
    acceleration: positive(profile.acceleration, 5000),
    minimumLayerTime: Math.max(0, profile.minimumLayerTime),
    filamentDiameter: positive(profile.filamentDiameter, 1.75),
  }
}

/** Parse progress, 0..1. */
export type ParseProgress = (fraction: number) => void

export function parseGcodeText(
  gcode: string,
  mode: SimulationMode = 'emitted_gcode_audit',
  onProgress?: ParseProgress,
): PrintWorkload {
  const parser = new GcodeParser(peekArcDiscretization(gcode))
  const lines = gcode.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    parser.push(lines[index])
    if (onProgress && index % 200_000 === 0) onProgress(index / lines.length)
  }
  return parser.finish(mode)
}

export type FeedPolicy = 'as_emitted' | 'virtual_limits'

export function inferTypicalExtrusionSpeed(workload: PrintWorkload): number {
  const speeds = workload.segments
    .filter((segment) => segment.extrusionLength > 0)
    .map((segment) => segment.requestedSpeed)
    .sort((a, b) => a - b)

  if (!speeds.length) return 50
  // p90 keeps most emitted F under the default what-if path speed (parity).
  return Math.max(speeds[Math.floor((speeds.length - 1) * 0.9)] ?? 50, EPSILON)
}

function filamentAreaOf(settings: PrinterSettings): number {
  return Math.PI * (settings.filamentDiameter / 2) ** 2
}

function volumeOf(segment: WorkloadSegment, filamentArea: number): number {
  return segment.extrusionLength * filamentArea
}

function isPrintExtrusion(segment: WorkloadSegment): boolean {
  return segment.extrusionLength > 0 && !segment.extrudeOnly
}

function segmentCruiseSpeed(
  segment: WorkloadSegment,
  settings: PrinterSettings,
  filamentArea: number,
  policy: FeedPolicy,
  fileTypicalSpeed: number | undefined,
  naturalSpeed: number,
  applySpeedScale: boolean,
): { cruise: number; volume: number } {
  const volume = volumeOf(segment, filamentArea)

  if (segment.extrudeOnly) {
    return { cruise: segment.requestedSpeed, volume }
  }

  if (policy === 'as_emitted') {
    return {
      cruise: Math.min(segment.requestedSpeed, settings.maxPrintSpeed),
      volume,
    }
  }

  // Travel, retracts and the first layer stay as in the file.
  if (!applySpeedScale) {
    return { cruise: segment.requestedSpeed, volume }
  }
  const typical = Math.max(fileTypicalSpeed ?? settings.maxPrintSpeed, EPSILON)
  const scale = settings.maxPrintSpeed / typical
  return { cruise: Math.max(naturalSpeed * scale, EPSILON), volume }
}

function firstExtrusionLayerIndex(segments: WorkloadSegment[]): number {
  let first = Number.POSITIVE_INFINITY
  for (const segment of segments) {
    if (isPrintExtrusion(segment)) first = Math.min(first, segment.layerIndex)
  }
  return first
}

function naturalPrintSpeed(
  segment: WorkloadSegment,
  roleSpeed: number,
  firstLayer: number,
): number {
  if (!isPrintExtrusion(segment) || segment.layerIndex === firstLayer || roleSpeed <= 0) {
    return segment.requestedSpeed
  }
  return Math.max(segment.requestedSpeed, roleSpeed)
}

export interface EvaluateOptions {
  junction?: JunctionModel
}

export function evaluateWorkload(
  workload: PrintWorkload,
  profile: PrinterSettings,
  policy: FeedPolicy = 'as_emitted',
  fileTypicalSpeed?: number,
  options: EvaluateOptions = {},
): AnalysisResult {
  const settings = normalizedSettings(profile)
  const filamentArea = filamentAreaOf(settings)
  const layers = new Map<number, LayerStats>()
  let movementSeconds = 0
  let idealSeconds = workload.dwellSeconds
  let mechanicsSeconds = 0
  let hotendSeconds = 0
  const mode: SimulationMode =
    policy === 'virtual_limits' ? 'virtual_path_retiming' : 'emitted_gcode_audit'
  const typical =
    policy === 'virtual_limits'
      ? Math.max(fileTypicalSpeed ?? inferTypicalExtrusionSpeed(workload), EPSILON)
      : undefined
  const limits = motionLimitsFromConfig(
    workload.slicer.config,
    options.junction ??
      junctionModelFor(workload.slicer.slicer, workload.slicer.config.gcode_flavor),
  )
  // Emitted per-role accelerations follow the profile acceleration proportionally.
  const accelerationScale =
    settings.acceleration / (workload.referenceAcceleration ?? settings.acceleration)
  const envelopeBreaches: EnvelopeBreach[] = []
  if (policy === 'virtual_limits') {
    const lift = Math.max(1, accelerationScale)
    if (lift > 1 + 1e-9) {
      const fromAccel =
        limits.maxAccelExtruding > 0
          ? limits.maxAccelExtruding
          : Math.max(limits.maxAccelX, limits.maxAccelY)
      if (fromAccel > 0) {
        envelopeBreaches.push({
          limit: 'machine_max_acceleration',
          from: fromAccel,
          to: fromAccel * lift,
        })
      }
      limits.maxAccelX *= lift
      limits.maxAccelY *= lift
      limits.maxAccelExtruding *= lift
    }
    const maxRoleSpeed = workload.roles.reduce(
      (best, role) => Math.max(best, roleTargetSpeed(role, workload.slicer.config) ?? 0),
      0,
    )
    const scale = typical ? settings.maxPrintSpeed / typical : 1
    const projectedSpeed = Math.max(settings.maxPrintSpeed, maxRoleSpeed * Math.max(1, scale))
    if (limits.maxSpeedX > 0 && projectedSpeed > limits.maxSpeedX + 1e-9) {
      envelopeBreaches.push({
        limit: 'machine_max_speed',
        from: limits.maxSpeedX,
        to: projectedSpeed,
      })
      limits.maxSpeedX = projectedSpeed
      limits.maxSpeedY = Math.max(limits.maxSpeedY, projectedSpeed)
    }
  }
  const segments = workload.segments
  const firstLayer = firstExtrusionLayerIndex(segments)
  const roleSpeeds = workload.roles.map((role) => roleTargetSpeed(role, workload.slicer.config) ?? 0)
  const cruiseSpeeds = new Float64Array(segments.length)
  const accelerations = new Float64Array(segments.length)
  const volumes = new Float64Array(segments.length)

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]
    const roleSpeed = segment.role >= 0 ? roleSpeeds[segment.role] : 0
    const natural =
      policy === 'virtual_limits' ? naturalPrintSpeed(segment, roleSpeed, firstLayer) : segment.requestedSpeed
    const applySpeedScale =
      policy === 'virtual_limits' && isPrintExtrusion(segment) && segment.layerIndex !== firstLayer
    const { cruise, volume } = segmentCruiseSpeed(
      segment,
      settings,
      filamentArea,
      policy,
      typical,
      natural,
      applySpeedScale,
    )
    cruiseSpeeds[index] = cruise
    volumes[index] = volume
    accelerations[index] =
      segment.acceleration > 0
        ? policy === 'virtual_limits' && !applySpeedScale
          ? segment.acceleration
          : segment.acceleration * accelerationScale
        : segment.extrudeOnly && limits.retractAcceleration > 0
          ? limits.retractAcceleration
          : settings.acceleration
  }

  const mechanicalTimes = planSegmentTimes(
    segments,
    cruiseSpeeds,
    accelerations,
    limits,
  )

  const roleCount = workload.roles.length
  // Buckets: slicer roles, then "no marker" print, travel, retract.
  const roleSeconds = new Float64Array(roleCount + 3)
  const roleIdeal = new Float64Array(roleCount + 3)
  const roleFilament = new Float64Array(roleCount + 3)
  const flowRates = new Float64Array(segments.length)
  const flowTimes = new Float64Array(segments.length)
  let flowCount = 0
  let filamentLength = 0
  let travelDistance = 0

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]
    const cruise = cruiseSpeeds[index]
    const volume = volumes[index]
    // as_emitted: ideal = file F (speed caps land in mechanics).
    // virtual: ideal = retimed cruise (accel overhead is the only mechanics extra).
    const idealSpeed =
      policy === 'virtual_limits' ? cruise : segment.requestedSpeed
    const idealTime = segment.distance / Math.max(idealSpeed, EPSILON)
    const mechanicalTime = mechanicalTimes[index]
    const flowTime = volume > 0 ? volume / settings.maxVolumetricFlow : 0
    const movementTime = Math.max(mechanicalTime, flowTime)

    idealSeconds += idealTime
    mechanicsSeconds += Math.max(0, mechanicalTime - idealTime)
    hotendSeconds += Math.max(0, flowTime - mechanicalTime)
    movementSeconds += movementTime

    const bucket = segment.extrudeOnly
      ? roleCount + 2
      : segment.extrusionLength > 0
        ? segment.role >= 0
          ? segment.role
          : roleCount
        : roleCount + 1
    roleSeconds[bucket] += movementTime
    roleIdeal[bucket] += idealTime
    roleFilament[bucket] += segment.extrusionLength
    filamentLength += segment.extrusionLength
    if (volume > 0) {
      flowRates[flowCount] = volume / movementTime
      flowTimes[flowCount] = movementTime
      flowCount += 1
    } else if (!segment.extrudeOnly) travelDistance += segment.distance

    const layer = layers.get(segment.layerIndex) ?? {
      seconds: 0,
      idealSeconds: 0,
      z: segment.z,
      hasExtrusion: false,
      extrusionSeconds: 0,
      extrusionDistance: 0,
    }
    layer.seconds += movementTime
    layer.idealSeconds += idealTime
    if (volume > 0) {
      if (!layer.hasExtrusion) layer.z = segment.z
      layer.hasExtrusion = true
      layer.extrusionSeconds += movementTime
      layer.extrusionDistance += segment.distance
    }
    layers.set(segment.layerIndex, layer)
  }

  const slowDownMinSpeed =
    policy === 'virtual_limits' ? slicerSlowDownMinSpeed(workload.slicer.config) ?? 0 : 0
  const printedLayers = [...layers.entries()]
    .sort((a, b) => a[0] - b[0])
    .filter(([, layer]) => layer.hasExtrusion)
  const layerTimes: LayerTime[] = printedLayers.map(([index, layer], order) => {
    let cooling = 0
    if (order > 0 && settings.minimumLayerTime > 0) {
      // Orca stretches extrusion so the printed (not travel) time meets
      // slow_down_layer_time; travel already happened and does not count.
      const printed = policy === 'virtual_limits' ? layer.extrusionSeconds : layer.seconds
      if (settings.minimumLayerTime > printed) {
        cooling = settings.minimumLayerTime - printed
        if (slowDownMinSpeed > 0 && layer.extrusionDistance > 0) {
          const maxPrinted = layer.extrusionDistance / slowDownMinSpeed
          cooling = Math.max(0, Math.min(settings.minimumLayerTime, maxPrinted) - printed)
        }
      }
    }
    return {
      index,
      z: layer.z,
      seconds: layer.seconds + cooling,
      idealSeconds: layer.idealSeconds,
      coolingSeconds: cooling,
    }
  })
  const coolingSeconds = layerTimes.reduce((sum, layer) => sum + layer.coolingSeconds, 0)
  const roleTimes: RoleTime[] = []
  for (let bucket = 0; bucket < roleSeconds.length; bucket += 1) {
    if (roleSeconds[bucket] <= 0) continue
    const kind: RoleKind =
      bucket === roleCount + 1 ? 'travel' : bucket === roleCount + 2 ? 'retract' : 'print'
    roleTimes.push({
      role: bucket < roleCount ? workload.roles[bucket] : kind === 'print' ? '' : kind,
      kind,
      seconds: roleSeconds[bucket],
      idealSeconds: roleIdeal[bucket],
      filamentLength: roleFilament[bucket],
    })
  }
  roleTimes.sort((a, b) => b.seconds - a.seconds)
  const constraintSeconds = {
    hotend: hotendSeconds,
    mechanics: mechanicsSeconds,
    cooling: coolingSeconds,
  }
  const constrainedTotal = Object.values(constraintSeconds).reduce(
    (sum, value) => sum + value,
    0,
  )
  const constraintPercent = {
    hotend: constrainedTotal ? (hotendSeconds / constrainedTotal) * 100 : 0,
    mechanics: constrainedTotal ? (mechanicsSeconds / constrainedTotal) * 100 : 0,
    cooling: constrainedTotal ? (coolingSeconds / constrainedTotal) * 100 : 0,
  }
  const ranked = Object.entries(constraintSeconds).sort((a, b) => b[1] - a[1])
  const dominant =
    constrainedTotal > 0
      ? (ranked[0][0] as Exclude<BottleneckKind, 'none'>)
      : 'none'
  const warnings: AnalysisWarning[] = []

  if (workload.imperialUnits) warnings.push({ code: 'imperial' })
  if (!workload.extrusionMoveCount) warnings.push({ code: 'no_extrusion' })

  return {
    mode,
    confidence: workload.intent.available ? 'medium' : 'low',
    estimatedSeconds: movementSeconds + coolingSeconds + workload.dwellSeconds,
    idealSeconds,
    dominant,
    constraintSeconds,
    constraintPercent,
    lineCount: workload.lineCount,
    moveCount: workload.moveCount,
    extrusionMoveCount: workload.extrusionMoveCount,
    layerCount: printedLayers.length,
    layers: layerTimes,
    roles: roleTimes,
    flow: flowStats(
      flowRates.subarray(0, flowCount),
      flowTimes.subarray(0, flowCount),
      settings.maxVolumetricFlow,
    ),
    filamentLength,
    travelDistance,
    warnings,
    envelopeBreaches,
  }
}

function flowStats(rates: Float64Array, times: Float64Array, limit: number): FlowStats {
  let peak = 0
  let total = 0
  let nearLimit = 0
  for (let index = 0; index < rates.length; index += 1) {
    peak = Math.max(peak, rates[index])
    total += times[index]
    if (rates[index] >= limit * 0.9) nearLimit += times[index]
  }
  const span = Math.max(limit, peak) * 1.05
  const binWidth = span <= 30 ? 0.5 : span <= 60 ? 1 : 2
  const bins = new Array<number>(Math.max(1, Math.ceil(span / binWidth))).fill(0)
  for (let index = 0; index < rates.length; index += 1) {
    bins[Math.min(bins.length - 1, Math.floor(rates[index] / binWidth))] += times[index]
  }
  const percentile = (share: number) => {
    let accumulated = 0
    for (let bin = 0; bin < bins.length; bin += 1) {
      accumulated += bins[bin]
      if (accumulated >= total * share) return (bin + 0.5) * binWidth
    }
    return peak
  }

  return {
    limit,
    p50: total ? percentile(0.5) : 0,
    p95: total ? percentile(0.95) : 0,
    peak,
    bins,
    binWidth,
    nearLimitShare: total ? nearLimit / total : 0,
    extrusionSeconds: total,
  }
}

export function analyzeGcodeText(
  gcode: string,
  profile: PrinterSettings,
  policy: FeedPolicy = 'as_emitted',
  fileTypicalSpeed?: number,
): AnalysisResult {
  const workload = parseGcodeText(gcode)
  return evaluateWorkload(
    workload,
    profile,
    policy,
    fileTypicalSpeed ??
      (policy === 'virtual_limits'
        ? inferTypicalExtrusionSpeed(workload)
        : undefined),
  )
}

export async function parseGcodeFile(
  file: File,
  onProgress?: ParseProgress,
): Promise<PrintWorkload> {
  const head = await file.slice(0, 16_384).text()
  const tailStart = Math.max(0, file.size - 131_072)
  const tail = tailStart > 16_384 ? await file.slice(tailStart).text() : ''
  const parser = new GcodeParser(peekArcDiscretization(head + '\n' + tail))
  const reader = file.stream().getReader()
  const decoder = new TextDecoder()
  let remainder = ''
  let bytes = 0

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    bytes += value.byteLength
    const lines = (remainder + decoder.decode(value, { stream: true })).split(/\r?\n/)
    remainder = lines.pop() ?? ''
    for (const line of lines) parser.push(line)
    onProgress?.(file.size ? bytes / file.size : 0)
  }

  remainder += decoder.decode()
  if (remainder) parser.push(remainder)
  return parser.finish()
}

export async function analyzeGcodeFile(
  file: File,
  profile: PrinterSettings,
  policy: FeedPolicy = 'as_emitted',
  fileTypicalSpeed?: number,
): Promise<AnalysisResult> {
  const workload = await parseGcodeFile(file)
  return evaluateWorkload(
    workload,
    profile,
    policy,
    fileTypicalSpeed ??
      (policy === 'virtual_limits'
        ? inferTypicalExtrusionSpeed(workload)
        : undefined),
  )
}
