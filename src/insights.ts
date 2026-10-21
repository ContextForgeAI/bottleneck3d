import type { PrinterSettings } from './domain/profile'
import type { AnalysisResult } from './domain/result'

/** Where print time goes, in the order shown to the user. */
export type Category = 'print' | 'mechanics' | 'travel' | 'hotend' | 'cooling' | 'pauses'

export const CATEGORIES: Category[] = ['print', 'mechanics', 'travel', 'hotend', 'cooling', 'pauses']

export type CategoryTimes = Record<Category, number>

/**
 * Splits the estimate into disjoint parts: travel moves (with their own accel losses)
 * are pulled out of "at speed" and "accel/decel", so the parts add up to the total.
 */
export function timeCategories(result: AnalysisResult): CategoryTimes {
  let travelSeconds = 0
  let travelIdeal = 0
  for (const role of result.roles) {
    if (role.kind === 'print') continue
    travelSeconds += role.seconds
    travelIdeal += Math.min(role.idealSeconds, role.seconds)
  }
  const print = Math.max(0, result.idealSeconds - travelIdeal)
  const mechanics = Math.max(0, result.constraintSeconds.mechanics - (travelSeconds - travelIdeal))
  const { hotend, cooling } = result.constraintSeconds
  const pauses = Math.max(
    0,
    result.estimatedSeconds - print - mechanics - travelSeconds - hotend - cooling,
  )
  return { print, mechanics, travel: travelSeconds, hotend, cooling, pauses }
}

export type LeverKey = 'maxPrintSpeed' | 'acceleration' | 'maxVolumetricFlow' | 'minimumLayerTime'

export interface LeverSpec {
  key: LeverKey
  min: number
  max: number
  step: number
  digits: number
}

export const LEVERS: LeverSpec[] = [
  { key: 'acceleration', min: 500, max: 50000, step: 100, digits: 0 },
  { key: 'maxVolumetricFlow', min: 2, max: 80, step: 0.5, digits: 1 },
  { key: 'maxPrintSpeed', min: 20, max: 600, step: 5, digits: 0 },
  { key: 'minimumLayerTime', min: 0, max: 30, step: 0.5, digits: 1 },
]

export type ScenarioId =
  | 'accel15'
  | 'accel2'
  | 'flow15'
  | 'flow2'
  | 'speed125'
  | 'speed15'
  | 'combo'

export interface Scenario {
  id: ScenarioId
  kind: 'hardware' | 'profile' | 'combo'
  /** Category this upgrade attacks; used to link the overview to the upgrade. */
  targets: Category[]
  profile: PrinterSettings
}

export function buildScenarios(reference: PrinterSettings): Scenario[] {
  const make = (
    id: ScenarioId,
    kind: Scenario['kind'],
    targets: Category[],
    changes: Partial<PrinterSettings>,
  ): Scenario => ({ id, kind, targets, profile: { ...reference, ...changes } })
  const accel = reference.acceleration
  const flow = reference.maxVolumetricFlow
  const speed = reference.maxPrintSpeed
  return [
    make('accel15', 'hardware', ['mechanics'], { acceleration: Math.round(accel * 1.5) }),
    make('accel2', 'hardware', ['mechanics'], { acceleration: Math.round(accel * 2) }),
    make('flow15', 'hardware', ['hotend'], { maxVolumetricFlow: flow * 1.5 }),
    make('flow2', 'hardware', ['hotend'], { maxVolumetricFlow: flow * 2 }),
    make('speed125', 'profile', ['print', 'travel'], { maxPrintSpeed: Math.round(speed * 1.25) }),
    make('speed15', 'profile', ['print', 'travel'], { maxPrintSpeed: Math.round(speed * 1.5) }),
    make('combo', 'combo', ['print', 'mechanics', 'travel', 'hotend'], {
      acceleration: Math.round(accel * 2),
      maxVolumetricFlow: flow * 2,
      maxPrintSpeed: Math.round(speed * 1.5),
    }),
  ]
}

export function sameProfile(a: PrinterSettings, b: PrinterSettings): boolean {
  return (
    a.acceleration === b.acceleration &&
    a.maxPrintSpeed === b.maxPrintSpeed &&
    a.maxVolumetricFlow === b.maxVolumetricFlow &&
    a.minimumLayerTime === b.minimumLayerTime &&
    a.filamentDiameter === b.filamentDiameter
  )
}

/** The largest time sink besides moving at the requested speed. */
export function mainLoss(times: CategoryTimes): Exclude<Category, 'print'> | null {
  const losses = CATEGORIES.filter((id) => id !== 'print') as Array<Exclude<Category, 'print'>>
  const ranked = losses.map((id) => [id, times[id]] as const).sort((a, b) => b[1] - a[1])
  return ranked[0][1] >= 1 ? ranked[0][0] : null
}
