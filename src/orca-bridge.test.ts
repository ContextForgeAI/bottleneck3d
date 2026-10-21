import { describe, expect, it } from 'vitest'
import { DEFAULT_PRINTER_SETTINGS } from './domain/profile'
import { resliceChangesFromProfiles, resliceChangesKey } from './orca-bridge'

const base = {
  ...DEFAULT_PRINTER_SETTINGS,
  acceleration: 5000,
  maxPrintSpeed: 120,
  maxVolumetricFlow: 23,
  minimumLayerTime: 6,
}

describe('resliceChangesFromProfiles', () => {
  it('returns null when the virtual profile matches the reference', () => {
    expect(resliceChangesFromProfiles(base, { ...base })).toBeNull()
  })

  it('maps the same levers as the instant forecast, including envelope lifts', () => {
    expect(
      resliceChangesFromProfiles(
        base,
        { ...base, acceleration: 2500, maxPrintSpeed: 180, maxVolumetricFlow: 15, minimumLayerTime: 0 },
        [{ limit: 'machine_max_speed', from: 300, to: 400 }],
      ),
    ).toEqual({
      accelerationScale: 0.5,
      printSpeedScale: 1.5,
      maxVolumetricFlow: 15,
      minimumLayerTime: 0,
      raiseMachineSpeed: true,
      raiseMachineSpeedTo: 400,
    })
  })

  it('raises machine acceleration when the lever is above the file value', () => {
    expect(resliceChangesFromProfiles(base, { ...base, acceleration: 10000 })).toEqual({
      accelerationScale: 2,
      raiseMachineAcceleration: true,
    })
  })

  it('keys results to the exact changes payload', () => {
    const changes = resliceChangesFromProfiles(base, { ...base, acceleration: 2500 })
    expect(resliceChangesKey(changes)).toBe(resliceChangesKey({ accelerationScale: 0.5 }))
  })
})
