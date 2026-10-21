import type { Confidence } from './sources'
import type { SimulationMode } from './simulation-mode'

export type BottleneckKind = 'hotend' | 'mechanics' | 'cooling' | 'none'

export interface ConstraintBreakdown {
  hotend: number
  mechanics: number
  cooling: number
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
  warnings: string[]
}
