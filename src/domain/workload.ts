import type { SlicerMetadata } from '../slicer-metadata.ts'
import type { SimulationMode } from './simulation-mode'

export interface SlicerIntent {
  available: boolean
  source: 'unknown' | 'orca_resolved_profile' | 'gcode_metadata'
  missing: string[]
}

export interface WorkloadSegment {
  /** XYZ length; |dE| for extrude-only moves (retract / unretract). */
  distance: number
  requestedSpeed: number
  extrusionLength: number
  z: number
  /** Print layer index from slicer markers or extrusion-Z fallback. */
  layerIndex: number
  dx: number
  dy: number
  dz: number
  de: number
  extrudeOnly: boolean
  /** Emitted acceleration active for this move, 0 when the file set none. */
  acceleration: number
  /**
   * Live Klipper/Orca toolhead ACCEL (SET_VELOCITY_LIMIT / M204 S) at this
   * move. Differs from `acceleration` on retracts, where the move uses
   * max_extrude_only_accel.
   */
  toolheadAcceleration: number
  /** Emitted square corner velocity / XY jerk, 0 when the file set none. */
  cornerVelocity: number
  /** Emitted Klipper ACCEL_TO_DECEL, 0 when MINIMUM_CRUISE_RATIO is in effect. */
  accelToDecel: number
  /** Emitted Klipper MINIMUM_CRUISE_RATIO, or -1 when using ACCEL_TO_DECEL. */
  minimumCruiseRatio: number
  /** G4 / M400 / G92 without E before this move drains the planner queue. */
  syncBefore: boolean
  /** Index into PrintWorkload.roles of the last ;TYPE: / ; FEATURE: marker, -1 before any. */
  role: number
}

export interface PrintWorkload {
  mode: SimulationMode
  intent: SlicerIntent
  lineCount: number
  moveCount: number
  extrusionMoveCount: number
  arcCount: number
  imperialUnits: boolean
  /** Distinct accelerations set by M204 / SET_VELOCITY_LIMIT, ascending. */
  emittedAccelerations: number[]
  /**
   * Acceleration the emitted per-move values are relative to: slicer
   * default_acceleration, else the most frequent emitted value.
   */
  referenceAcceleration: number | null
  dwellSeconds: number
  slicer: SlicerMetadata
  /** Slicer line roles as written in the file ("Outer wall", "Perimeter", "FILL"). */
  roles: string[]
  segments: WorkloadSegment[]
}

export const emittedGcodeIntent: SlicerIntent = {
  available: false,
  source: 'unknown',
  missing: [
    'line roles',
    'role target speeds before slicer caps',
    'role accelerations before emitted G-code',
  ],
}
