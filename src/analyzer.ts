import type { PrinterSettings } from './domain/profile'
import type { BottleneckKind, AnalysisResult } from './domain/result'
import type { SimulationMode } from './domain/simulation-mode'
import {
  emittedGcodeIntent,
  type PrintWorkload,
  type WorkloadSegment,
} from './domain/workload'

interface Position {
  x: number
  y: number
  z: number
  e: number
}

interface LayerStats {
  seconds: number
  hasExtrusion: boolean
}

const EPSILON = 1e-9
/** Ignore Z-hop / micro jitter when slicer layer markers are absent. */
const LAYER_Z_EPSILON = 0.05

function positive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function trapezoidTime(
  distance: number,
  speed: number,
  acceleration: number,
): number {
  if (distance <= EPSILON || speed <= EPSILON) return 0

  const accelerationDistance = (speed * speed) / acceleration
  if (accelerationDistance >= distance) {
    return 2 * Math.sqrt(distance / acceleration)
  }

  return 2 * (speed / acceleration) + (distance - accelerationDistance) / speed
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

  push(line: string): void {
    this.lineCount += 1

    if (isLayerChangeComment(line)) {
      this.usedLayerMarkers = true
      this.layerMarkerCount += 1
      this.layerIndex = Math.max(0, this.layerMarkerCount - 1)
      return
    }

    const commandText = line.split(';', 1)[0].trim()
    if (!commandText) return

    const values = parameters(commandText)
    const command = commandText.match(/^\s*([A-Za-z]\d+)/)?.[1].toUpperCase()

    switch (command) {
      case 'G0':
      case 'G1':
        this.processMove(values)
        break
      case 'G2':
      case 'G3':
        this.arcCount += 1
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
        this.setPosition(values)
        break
      case 'M82':
        this.absoluteExtrusion = true
        break
      case 'M83':
        this.absoluteExtrusion = false
        break
    }
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
      segments: this.segments,
    }
  }

  private processMove(values: Map<string, number>): void {
    if (values.has('F')) this.feedRate = values.get('F') ?? this.feedRate
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

    const dx = next.x - this.position.x
    const dy = next.y - this.position.y
    const dz = next.z - this.position.z
    const deltaE = next.e - this.position.e
    const distance = Math.hypot(dx, dy, dz)
    const requestedSpeed = this.feedRate / 60
    this.position = next

    if (distance <= EPSILON || requestedSpeed <= EPSILON) return

    const extrusionLength = Math.max(0, deltaE)
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
    })

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

export function parseGcodeText(
  gcode: string,
  mode: SimulationMode = 'emitted_gcode_audit',
): PrintWorkload {
  const parser = new GcodeParser()
  for (const line of gcode.split(/\r?\n/)) parser.push(line)
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

function segmentCruiseSpeed(
  segment: WorkloadSegment,
  settings: PrinterSettings,
  filamentArea: number,
  policy: FeedPolicy,
  fileTypicalSpeed: number | undefined,
): { cruise: number; volume: number } {
  const volume = volumeOf(segment, filamentArea)

  if (policy === 'as_emitted') {
    return {
      cruise: Math.min(segment.requestedSpeed, settings.maxPrintSpeed),
      volume,
    }
  }

  // Retarget the same path: keep relative F shape, scale so file-typical extrusion
  // maps to the what-if "path speed". Flow is applied later via flowTime — do not
  // pre-cap cruise, or hotend extras disappear into "slower motion".
  const typical = Math.max(fileTypicalSpeed ?? settings.maxPrintSpeed, EPSILON)
  const scale = settings.maxPrintSpeed / typical
  const cruise = Math.min(
    Math.max(segment.requestedSpeed * scale, EPSILON),
    settings.maxPrintSpeed,
  )
  return { cruise, volume }
}

export function evaluateWorkload(
  workload: PrintWorkload,
  profile: PrinterSettings,
  policy: FeedPolicy = 'as_emitted',
  fileTypicalSpeed?: number,
): AnalysisResult {
  const settings = normalizedSettings(profile)
  const filamentArea = filamentAreaOf(settings)
  const layers = new Map<number, LayerStats>()
  let movementSeconds = 0
  let idealSeconds = 0
  let mechanicsSeconds = 0
  let hotendSeconds = 0
  const mode: SimulationMode =
    policy === 'virtual_limits' ? 'virtual_path_retiming' : 'emitted_gcode_audit'
  const typical =
    policy === 'virtual_limits'
      ? Math.max(fileTypicalSpeed ?? inferTypicalExtrusionSpeed(workload), EPSILON)
      : undefined

  for (const segment of workload.segments) {
    const { cruise, volume } = segmentCruiseSpeed(
      segment,
      settings,
      filamentArea,
      policy,
      typical,
    )
    // as_emitted: ideal = file F (speed caps land in mechanics).
    // virtual: ideal = retimed cruise (accel overhead is the only mechanics extra).
    const idealSpeed =
      policy === 'virtual_limits' ? cruise : segment.requestedSpeed
    const idealTime = segment.distance / Math.max(idealSpeed, EPSILON)
    const mechanicalTime = trapezoidTime(
      segment.distance,
      cruise,
      settings.acceleration,
    )
    const flowTime = volume > 0 ? volume / settings.maxVolumetricFlow : 0
    const movementTime = Math.max(mechanicalTime, flowTime)

    idealSeconds += idealTime
    mechanicsSeconds += Math.max(0, mechanicalTime - idealTime)
    hotendSeconds += Math.max(0, flowTime - mechanicalTime)
    movementSeconds += movementTime

    const layer = layers.get(segment.layerIndex) ?? {
      seconds: 0,
      hasExtrusion: false,
    }
    layer.seconds += movementTime
    if (volume > 0) layer.hasExtrusion = true
    layers.set(segment.layerIndex, layer)
  }

  const printedLayers = [...layers.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, layer]) => layer)
    .filter((layer) => layer.hasExtrusion)
  const coolingSeconds = printedLayers.slice(1).reduce((sum, layer) => {
    return sum + Math.max(0, settings.minimumLayerTime - layer.seconds)
  }, 0)
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
  const warnings: string[] = []

  if (policy === 'as_emitted') {
    warnings.push(
      'Это время «как в файле». Справа what-if: двигай «скорость пути» — это главный рычаг без переслайса.',
    )
  } else {
    warnings.push(
      'Скорость пути масштабирует F из файла. Flow — потолок через время экструзии. Одинаковая скорость пути с файлом → то же время.',
    )
  }
  if (workload.arcCount) {
    warnings.push(
      `${workload.arcCount} дуговых перемещений G2/G3 пока не учтено в оценке.`,
    )
  }
  if (workload.imperialUnits) {
    warnings.push('G-code в дюймах пока не поддерживается.')
  }
  if (!workload.extrusionMoveCount) {
    warnings.push('Не найдены перемещения с экструзией.')
  }

  return {
    mode,
    confidence: workload.intent.available ? 'medium' : 'low',
    estimatedSeconds: movementSeconds + coolingSeconds,
    idealSeconds,
    dominant,
    constraintSeconds,
    constraintPercent,
    lineCount: workload.lineCount,
    moveCount: workload.moveCount,
    extrusionMoveCount: workload.extrusionMoveCount,
    layerCount: printedLayers.length,
    warnings,
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

export async function parseGcodeFile(file: File): Promise<PrintWorkload> {
  const parser = new GcodeParser()
  const reader = file
    .stream()
    .pipeThrough(new TextDecoderStream())
    .getReader()
  let remainder = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    const lines = (remainder + value).split(/\r?\n/)
    remainder = lines.pop() ?? ''
    for (const line of lines) parser.push(line)
  }

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
