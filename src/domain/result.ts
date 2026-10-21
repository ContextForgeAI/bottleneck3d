import type { Confidence } from './sources'
import type { SimulationMode } from './simulation-mode'

export type BottleneckKind = 'hotend' | 'mechanics' | 'cooling' | 'none'

export interface ConstraintBreakdown {
  hotend: number
  mechanics: number
  cooling: number
}

export interface LayerTime {
  index: number
  z: number
  /** Movement time plus the min-layer-time pause, seconds. */
  seconds: number
  /** Time at the requested (or what-if) F, seconds. */
  idealSeconds: number
  coolingSeconds: number
}

/** Kind of motion a role bucket holds; "print" buckets carry the slicer role name. */
export type RoleKind = 'print' | 'travel' | 'retract'

export interface RoleTime {
  /** Slicer role as written in the file, or "travel" / "retract" / "" (no marker). */
  role: string
  kind: RoleKind
  seconds: number
  idealSeconds: number
  /** Extruded filament length, mm. */
  filamentLength: number
}

export interface FlowStats {
  /** Hotend ceiling used for this evaluation, mm³/s. */
  limit: number
  /** Time-weighted percentiles of delivered volumetric flow while extruding. */
  p50: number
  p95: number
  peak: number
  /** Extrusion seconds per bin of `binWidth` mm³/s starting at 0. */
  bins: number[]
  binWidth: number
  /** Share of extrusion time at ≥ 90% of the limit, 0..1. */
  nearLimitShare: number
  extrusionSeconds: number
}

export type AnalysisWarning =
  | { code: 'arcs'; count: number }
  | { code: 'imperial' }
  | { code: 'no_extrusion' }

/** Machine limit the what-if lever raised above the G-code config envelope. */
export type EnvelopeLimit = 'machine_max_acceleration' | 'machine_max_speed'

export interface EnvelopeBreach {
  limit: EnvelopeLimit
  from: number
  to: number
}

export interface AnalysisResult {
  mode: SimulationMode
  confidence: Confidence
  estimatedSeconds: number
  idealSeconds: number
  dominant: BottleneckKind
  constraintSeconds: ConstraintBreakdown
  constraintPercent: ConstraintBreakdown
  lineCount: number
  moveCount: number
  extrusionMoveCount: number
  layerCount: number
  layers: LayerTime[]
  roles: RoleTime[]
  flow: FlowStats
  /** Total extruded filament, mm. */
  filamentLength: number
  travelDistance: number
  warnings: AnalysisWarning[]
  /** What-if raised a machine envelope from the file; empty for audit. */
  envelopeBreaches: EnvelopeBreach[]
}
