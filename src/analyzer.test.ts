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
    expect(result.warnings.map((warning) => warning.code)).not.toContain('no_extrusion')
  })

  it('warns when arcs cannot be included', () => {
    const result = analyzeGcodeText('G2 X10 Y10 I5 J5 F1200', profile)

    expect(result.warnings).toContainEqual({ code: 'arcs', count: 1 })
  })

  it('scales path speed from file typical and caps by flow', () => {
    const gcode = [
      'G90',
      'M83',
      ';LAYER_CHANGE',
      'G1 X1 E0.01 F6000',
      ';LAYER_CHANGE',
      'G1 X101 E20 F6000',
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
      'G1 X1 E0.01 F3000',
      ';LAYER_CHANGE',
      'G1 X101 E0.5 F3000',
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
    const gcode = ['G90', 'M83', ';LAYER_CHANGE', 'G1 X1 E0.01 F3000', ';LAYER_CHANGE', 'G1 X101 E1 F3000'].join('\n')
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

    // first layer stays at 50 mm/s (0.02 s); scale 200/50 = 4 → 200 mm/s on 100 mm → 0.5 s
    expect(result.idealSeconds).toBeCloseTo(0.52, 2)
    expect(result.constraintSeconds.mechanics).toBeGreaterThan(0.05)
    expect(result.estimatedSeconds).toBeGreaterThan(result.idealSeconds)
  })
})

function coolingSample(feed: number): string {
  return [
    '; generated by OrcaSlicer 2.5.0',
    'G90',
    'M83',
    'SET_VELOCITY_LIMIT ACCEL=100000 ACCEL_TO_DECEL=50000',
    ';LAYER_CHANGE',
    ';TYPE:Outer wall',
    `G1 X80 E4 F${feed}`,
    ';LAYER_CHANGE',
    ';TYPE:Outer wall',
    `G1 X160 E4 F${feed}`,
    ';LAYER_CHANGE',
    ';TYPE:Outer wall',
    `G1 X240 E4 F${feed}`,
    '; outer_wall_speed = 100',
    '; slow_down_layer_time = 6',
    '; slow_down_min_speed = 10',
    '; default_acceleration = 100000',
    '; filament_max_volumetric_speed = 80',
    '; filament_diameter = 1.75',
    '; gcode_flavor = klipper',
  ].join('\n')
}

describe('virtual_limits layer cooling', () => {
  const typical = 20
  const baseProfile: PrinterSettings = {
    maxVolumetricFlow: 80,
    maxPrintSpeed: typical,
    acceleration: 100000,
    minimumLayerTime: 6,
    filamentDiameter: 1.75,
  }

  it('unsows already-slowed F when minimumLayerTime is 0', () => {
    const slowed = coolingSample(1200)
    const unsowed = analyzeGcodeText(slowed, { ...baseProfile, minimumLayerTime: 0 }, 'virtual_limits', typical)
    const asEmitted = analyzeGcodeText(slowed, { ...baseProfile, minimumLayerTime: 0 })

    expect(unsowed.estimatedSeconds).toBeLessThan(asEmitted.estimatedSeconds * 0.55)
    expect(unsowed.constraintSeconds.cooling).toBe(0)
    expect(unsowed.layers[1].seconds).toBeCloseTo(0.8, 1)
  })

  it('stretches layers to the slicer minimum instead of scaling already-slowed F', () => {
    const slowed = coolingSample(1200)
    const atFile = analyzeGcodeText(slowed, baseProfile, 'virtual_limits', typical)
    const faster = analyzeGcodeText(
      slowed,
      { ...baseProfile, maxPrintSpeed: typical * 2 },
      'virtual_limits',
      typical,
    )
    const slower = analyzeGcodeText(
      slowed,
      { ...baseProfile, maxPrintSpeed: typical * 0.5 },
      'virtual_limits',
      typical,
    )

    expect(atFile.constraintSeconds.cooling).toBeGreaterThan(4)
    expect(faster.layers[1].seconds).toBeCloseTo(6, 1)
    expect(slower.layers[1].seconds).toBeCloseTo(6, 1)
    expect(faster.estimatedSeconds).toBeCloseTo(atFile.estimatedSeconds, 1)
    expect(slower.estimatedSeconds).toBeCloseTo(atFile.estimatedSeconds, 1)
  })

  it('attributes the stretch to cooling, not a G-code pause', () => {
    const result = analyzeGcodeText(coolingSample(1200), baseProfile, 'virtual_limits', typical)

    expect(result.constraintSeconds.cooling).toBeGreaterThan(4)
    expect(result.layers.filter((layer) => layer.coolingSeconds > 0).length).toBe(2)
  })
})

describe('virtual_limits machine envelope', () => {
  it('records a raised acceleration envelope and does not scale travel accel', () => {
    const gcode = [
      '; generated by OrcaSlicer 2.5.0',
      'G90',
      'M83',
      ';LAYER_CHANGE',
      'SET_VELOCITY_LIMIT ACCEL=5000 ACCEL_TO_DECEL=2500',
      ';TYPE:Outer wall',
      'G1 X10 E0.1 F3000',
      ';LAYER_CHANGE',
      'SET_VELOCITY_LIMIT ACCEL=6000 ACCEL_TO_DECEL=3000',
      'G1 X50 F18000',
      'SET_VELOCITY_LIMIT ACCEL=5000 ACCEL_TO_DECEL=2500',
      ';TYPE:Outer wall',
      'G1 X150 E2 F3000',
      '; default_acceleration = 5000',
      '; machine_max_acceleration_x = 6000',
      '; machine_max_acceleration_y = 6000',
      '; machine_max_acceleration_extruding = 6000',
      '; machine_max_speed_x = 300',
      '; machine_max_speed_y = 300',
      '; gcode_flavor = klipper',
    ].join('\n')

    const typical = 50
    const reference = {
      ...profile,
      maxPrintSpeed: typical,
      acceleration: 5000,
      minimumLayerTime: 0,
    }
    const raised = analyzeGcodeText(
      gcode,
      { ...reference, acceleration: 10000 },
      'virtual_limits',
      typical,
    )
    const halved = analyzeGcodeText(
      gcode,
      { ...reference, acceleration: 2500 },
      'virtual_limits',
      typical,
    )
    const identity = analyzeGcodeText(gcode, reference, 'virtual_limits', typical)

    expect(raised.envelopeBreaches).toEqual([
      { limit: 'machine_max_acceleration', from: 6000, to: 12000 },
    ])
    expect(identity.envelopeBreaches).toEqual([])
    expect(halved.envelopeBreaches).toEqual([])
    expect(halved.estimatedSeconds).toBeGreaterThan(identity.estimatedSeconds)
  })
})

