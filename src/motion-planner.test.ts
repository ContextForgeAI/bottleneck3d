import { describe, expect, it } from 'vitest'
import { evaluateWorkload, parseGcodeText } from './analyzer'
import type { PrinterSettings } from './domain/profile'
import { junctionModelFor, type JunctionModel } from './motion-planner'

const settings: PrinterSettings = {
  maxVolumetricFlow: 1000,
  maxPrintSpeed: 1000,
  acceleration: 1000,
  minimumLayerTime: 0,
  filamentDiameter: 1.75,
}
const models: JunctionModel[] = ['prusa_jerk', 'orca_jerk', 'orca_klipper', 'klipper']

function seconds(gcode: string[], junction: JunctionModel) {
  return evaluateWorkload(parseGcodeText(gcode.join('\n')), settings, 'as_emitted', undefined, {
    junction,
  }).estimatedSeconds
}

function straightLine(pieces: number): string[] {
  const lines = ['G90', 'M83', 'G1 F6000']
  for (let index = 1; index <= pieces; index += 1) {
    lines.push(`G1 X${((100 * index) / pieces).toFixed(4)} E0.01`)
  }
  return lines
}

describe('motion planner', () => {
  it.each(models)('does not stop between collinear segments (%s)', (junction) => {
    const whole = seconds(straightLine(1), junction)
    const split = seconds(straightLine(200), junction)

    expect(split).toBeCloseTo(whole, 1)
  })

  it.each(models)('slows down for a reversal (%s)', (junction) => {
    const straight = seconds(['G90', 'G1 X50 F6000', 'G1 X100'], junction)
    const reversal = seconds(['G90', 'G1 X50 F6000', 'G1 X0'], junction)

    expect(reversal).toBeGreaterThan(straight + 0.05)
  })

  it('applies emitted accelerations per move', () => {
    const slow = seconds(['G90', 'SET_VELOCITY_LIMIT ACCEL=200', 'G1 X100 F6000'], 'klipper')
    const fast = seconds(['G90', 'SET_VELOCITY_LIMIT ACCEL=5000', 'G1 X100 F6000'], 'klipper')

    expect(slow).toBeGreaterThan(fast + 0.3)
  })

  it('counts retract moves and dwells', () => {
    const plain = seconds(['G90', 'M83', 'G1 X10 E1 F600'], 'prusa_jerk')
    const withExtras = seconds(
      ['G90', 'M83', 'G1 X10 E1 F600', 'G1 E-2 F1200', 'G4 P1500', 'G1 E2 F1200'],
      'prusa_jerk',
    )

    expect(withExtras - plain).toBeGreaterThan(1.5 + 0.2)
  })

  it('picks the estimator of the slicer that produced the file', () => {
    expect(junctionModelFor('OrcaSlicer 2.4.2')).toBe('orca_jerk')
    expect(junctionModelFor('OrcaSlicer 2.5.0-alpha', 'klipper')).toBe('orca_klipper')
    expect(junctionModelFor('OrcaSlicer 2.5.0', 'marlin')).toBe('orca_jerk')
    expect(junctionModelFor('BambuStudio 1.9')).toBe('orca_jerk')
    expect(junctionModelFor('PrusaSlicer 2.5.0+win64')).toBe('prusa_jerk')
    expect(junctionModelFor(null)).toBe('prusa_jerk')
  })

  it('slows a square path relative to a straight run of the same length (orca_klipper)', () => {
    const straight = seconds(
      ['G90', 'SET_VELOCITY_LIMIT ACCEL=3000 ACCEL_TO_DECEL=1500 SQUARE_CORNER_VELOCITY=5', 'G1 X400 F6000'],
      'orca_klipper',
    )
    const square = seconds(
      [
        'G90',
        'SET_VELOCITY_LIMIT ACCEL=3000 ACCEL_TO_DECEL=1500 SQUARE_CORNER_VELOCITY=5',
        'G1 X100 F6000',
        'G1 Y100',
        'G1 X0',
        'G1 Y0',
      ],
      'orca_klipper',
    )

    expect(square).toBeGreaterThan(straight + 0.05)
  })

  it('does not keep speed through a 90° corner on short orca_klipper segments', () => {
    const lines = ['G90', 'SET_VELOCITY_LIMIT ACCEL=2000 ACCEL_TO_DECEL=1000 SQUARE_CORNER_VELOCITY=5', 'G1 F6000']
    for (let x = 1; x <= 20; x += 1) lines.push(`G1 X${x}`)
    for (let y = 1; y <= 20; y += 1) lines.push(`G1 Y${y}`)
    const bent = seconds(lines, 'orca_klipper')
    const straight = seconds(
      [
        'G90',
        'SET_VELOCITY_LIMIT ACCEL=2000 ACCEL_TO_DECEL=1000 SQUARE_CORNER_VELOCITY=5',
        'G1 X20 F6000',
        'G1 X40',
      ],
      'orca_klipper',
    )

    expect(bent).toBeGreaterThan(straight)
  })

  it('ignores ACCEL_TO_DECEL vs MINIMUM_CRUISE_RATIO on the 2.5.0-alpha estimator', () => {
    const path = ['G90', 'G1 X5 F6000', 'G1 Y5', 'G1 X0', 'G1 Y0']
    const fromRatio = seconds(
      ['SET_VELOCITY_LIMIT ACCEL=4000 MINIMUM_CRUISE_RATIO=0.5', ...path],
      'orca_klipper',
    )
    const fromAccelToDecel = seconds(
      ['SET_VELOCITY_LIMIT ACCEL=4000 ACCEL_TO_DECEL=2000', ...path],
      'orca_klipper',
    )

    expect(fromRatio).toBeCloseTo(fromAccelToDecel, 2)
  })
})
