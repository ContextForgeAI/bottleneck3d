import { describe, expect, it } from 'vitest'
import {
  analyzeGcodeText,
} from './analyzer'
import type { PrinterSettings } from './domain/profile'

const profile: PrinterSettings = {
  maxVolumetricFlow: 100,
  maxPrintSpeed: 500,
  acceleration: 1_000_000_000,
  minimumLayerTime: 0,
  filamentDiameter: 1.75,
}

describe('analyzeGcodeText', () => {
  it('finds a hotend flow bottleneck', () => {
    const result = analyzeGcodeText(
      ['G90', 'M83', 'G1 X100 E10 F6000'].join('\n'),
      { ...profile, maxVolumetricFlow: 1 },
    )

    expect(result.dominant).toBe('hotend')
    expect(result.mode).toBe('emitted_gcode_audit')
    expect(result.confidence).toBe('low')
    expect(result.constraintSeconds.hotend).toBeGreaterThan(20)
    expect(result.extrusionMoveCount).toBe(1)
  })

  it('finds a configured motion speed bottleneck', () => {
    const result = analyzeGcodeText('G1 X100 F6000', {
      ...profile,
      maxPrintSpeed: 50,
    })

    expect(result.dominant).toBe('mechanics')
    expect(result.estimatedSeconds).toBeCloseTo(2, 3)
  })

  it('adds cooling delay to short layers after the first layer', () => {
    const result = analyzeGcodeText(
      [
        'G90',
        'M83',
        'G1 Z0.2 F1200',
        'G1 X10 E0.1 F6000',
        'G1 Z0.4 F1200',
        'G1 X20 E0.1 F6000',
      ].join('\n'),
      { ...profile, minimumLayerTime: 10 },
    )

    expect(result.layerCount).toBe(2)
    expect(result.dominant).toBe('cooling')
    expect(result.constraintSeconds.cooling).toBeGreaterThan(9)
  })

  it('does not treat Z-hop as a new layer for cooling', () => {
    const result = analyzeGcodeText(
      [
        'G90',
        'M83',
        'G1 Z0.2 F1200',
        'G1 X10 E0.1 F6000',
        'G1 Z0.6 F1200',
        'G1 X20 F9000',
        'G1 Z0.2 F1200',
        'G1 X30 E0.1 F6000',
        'G1 Z0.4 F1200',
        'G1 X40 E0.1 F6000',
      ].join('\n'),
      { ...profile, minimumLayerTime: 10 },
    )

    expect(result.layerCount).toBe(2)
    expect(result.constraintSeconds.cooling).toBeGreaterThan(9)
    expect(result.constraintSeconds.cooling).toBeLessThan(20)
  })

  it('uses Orca LAYER_CHANGE comments as the layer boundary', () => {
    const result = analyzeGcodeText(
      [
        'G90',
        'M83',
        ';LAYER_CHANGE',
        ';Z:0.2',
        'G1 Z0.2 F1200',
        'G1 X10 E0.1 F6000',
        'G1 Z0.6 F1200',
        'G1 X15 F9000',
        'G1 Z0.2 F1200',
        'G1 X20 E0.1 F6000',
        ';LAYER_CHANGE',
        ';Z:0.4',
        'G1 Z0.4 F1200',
        'G1 X30 E0.1 F6000',
      ].join('\n'),
      { ...profile, minimumLayerTime: 10 },
    )

    expect(result.layerCount).toBe(2)
    expect(result.dominant).toBe('cooling')
  })

  it('supports absolute extrusion reset with G92', () => {
    const result = analyzeGcodeText(
      [
        'G90',
        'M82',
        'G1 X10 E1 F1200',
        'G92 E0',
        'G1 X20 E1 F1200',
      ].join('\n'),
      profile,
    )

    expect(result.extrusionMoveCount).toBe(2)
    expect(result.warnings).not.toContain('Не найдены перемещения с экструзией.')
  })

  it('warns when arcs cannot be included', () => {
    const result = analyzeGcodeText('G2 X10 Y10 I5 J5 F1200', profile)

    expect(result.warnings.some((warning) => warning.includes('G2/G3'))).toBe(
      true,
    )
  })

  it('scales path speed from file typical and caps by flow', () => {
    const gcode = [
      'G90',
      'M83',
      ';LAYER_CHANGE',
      'G1 X100 E20 F6000',
    ].join('\n')

    const slowFlow = {
      ...profile,
      maxVolumetricFlow: 2,
      maxPrintSpeed: 100,
      acceleration: 5000,
      minimumLayerTime: 0,
    }
    const typical = 100
    const asEmitted = analyzeGcodeText(gcode, slowFlow, 'as_emitted')
    const samePath = analyzeGcodeText(gcode, slowFlow, 'virtual_limits', typical)
    const fasterPath = analyzeGcodeText(
      gcode,
      { ...slowFlow, maxVolumetricFlow: 40, maxPrintSpeed: 100 },
      'virtual_limits',
      typical,
    )

    expect(samePath.estimatedSeconds).toBeCloseTo(asEmitted.estimatedSeconds, 1)
    expect(fasterPath.estimatedSeconds).toBeLessThan(asEmitted.estimatedSeconds * 0.5)
  })

  it('keeping file path speed and only raising flow does little when F is below ceiling', () => {
    const gcode = [
      'G90',
      'M83',
      ';LAYER_CHANGE',
      'G1 X100 E0.5 F3000',
    ].join('\n')

    const typical = 50
    const reference = {
      ...profile,
      maxVolumetricFlow: 12,
      maxPrintSpeed: typical,
      acceleration: 5000,
      minimumLayerTime: 0,
    }
    const moreFlow = {
      ...reference,
      maxVolumetricFlow: 19,
    }

    const asEmitted = analyzeGcodeText(
      gcode,
      { ...reference, maxPrintSpeed: 250 },
      'as_emitted',
    )
    const virtual = analyzeGcodeText(gcode, moreFlow, 'virtual_limits', typical)

    expect(virtual.estimatedSeconds).toBeCloseTo(asEmitted.estimatedSeconds, 2)
  })

  it('retimes ideal base with path speed so accel extras stay honest', () => {
    const gcode = ['G90', 'M83', ';LAYER_CHANGE', 'G1 X100 E1 F3000'].join('\n')
    const typical = 50
    const result = analyzeGcodeText(
      gcode,
      {
        ...profile,
        maxVolumetricFlow: 80,
        maxPrintSpeed: 200,
        acceleration: 1000,
        minimumLayerTime: 0,
      },
      'virtual_limits',
      typical,
    )

    // scale 200/50 = 4 → cruise 200 mm/s on a 100 mm move → ideal 0.5 s
    expect(result.idealSeconds).toBeCloseTo(0.5, 2)
    expect(result.constraintSeconds.mechanics).toBeGreaterThan(0.05)
    expect(result.estimatedSeconds).toBeGreaterThan(result.idealSeconds)
  })
})
