import type { SimulationMode } from './simulation-mode'

export interface SlicerIntent {
  available: boolean
  source: 'unknown' | 'orca_resolved_profile' | 'gcode_metadata'
  missing: string[]
}

export interface WorkloadSegment {
  distance: number
  requestedSpeed: number
  extrusionLength: number
  z: number
  /** Print layer index from slicer markers or extrusion-Z fallback. */
  layerIndex: number
}

export interface PrintWorkload {
  mode: SimulationMode
  intent: SlicerIntent
  lineCount: number
  moveCount: number
  extrusionMoveCount: number
  arcCount: number
  imperialUnits: boolean
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
