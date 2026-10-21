import { describe, expect, it } from 'vitest'
import { isVerifiedSlicer, timeConfidence } from './confidence'

const config = { gcode_flavor: 'klipper', default_acceleration: '3000' }

describe('isVerifiedSlicer', () => {
  it('accepts the checked Prusa and Orca versions', () => {
    expect(isVerifiedSlicer('PrusaSlicer 2.5.0')).toBe(true)
    expect(isVerifiedSlicer('PrusaSlicer 2.5.2')).toBe(true)
    expect(isVerifiedSlicer('OrcaSlicer 2.4.2')).toBe(true)
    expect(isVerifiedSlicer('OrcaSlicer 2.5.0-alpha', 'klipper')).toBe(true)
    expect(isVerifiedSlicer('OrcaSlicer 2.5.0-alpha', 'marlin')).toBe(true)
    expect(isVerifiedSlicer('OrcaSlicer 2.5.0-alpha', 'marlin2')).toBe(true)
  })

  it('rejects unverified slicers and newer Orca', () => {
    expect(isVerifiedSlicer('PrusaSlicer 2.6.0')).toBe(false)
    expect(isVerifiedSlicer('OrcaSlicer 2.3.1')).toBe(false)
    expect(isVerifiedSlicer('OrcaSlicer 2.5.0', 'klipper')).toBe(false)
    expect(isVerifiedSlicer('OrcaSlicer 2.5.0-alpha', 'reprap')).toBe(false)
    expect(isVerifiedSlicer('Cura 5.6')).toBe(false)
    expect(isVerifiedSlicer('BambuStudio 1.9')).toBe(false)
    expect(isVerifiedSlicer('SuperSlicer 2.5')).toBe(false)
  })
})

describe('timeConfidence', () => {
  it('marks a matching verified file as verified with the real delta', () => {
    const value = timeConfidence({
      oursSeconds: 100.04,
      slicer: 'OrcaSlicer 2.5.0-alpha',
      estimatedSeconds: 100,
      config,
    })
    expect(value.level).toBe('verified')
    expect(value.reason).toBeNull()
    expect(value.deltaPercent).toBeCloseTo(0.04, 5)
  })

  it('is approximate without a slicer estimate', () => {
    expect(
      timeConfidence({
        oursSeconds: 100,
        slicer: 'OrcaSlicer 2.5.0-alpha',
        estimatedSeconds: null,
        config,
      }).reason,
    ).toBe('no_estimate')
  })

  it('is approximate without a config block', () => {
    expect(
      timeConfidence({
        oursSeconds: 100,
        slicer: 'OrcaSlicer 2.5.0-alpha',
        estimatedSeconds: 100,
        config: {},
      }).reason,
    ).toBe('no_config')
  })

  it('is approximate for an unverified slicer even when the delta is tiny', () => {
    expect(
      timeConfidence({
        oursSeconds: 100,
        slicer: 'Cura 5.6',
        estimatedSeconds: 100,
        config: { layer_height: '0.2' },
      }).reason,
    ).toBe('unverified_slicer')
  })

  it('is approximate when the audit disagrees by more than 1%', () => {
    const value = timeConfidence({
      oursSeconds: 110,
      slicer: 'OrcaSlicer 2.4.2',
      estimatedSeconds: 100,
      config,
    })
    expect(value.level).toBe('approximate')
    expect(value.reason).toBe('delta')
    expect(value.deltaPercent).toBeCloseTo(10, 5)
  })
})
