import type { SlicerMetadata } from './slicer-metadata.ts'

export type ConfidenceLevel = 'verified' | 'approximate'

export type ApproximateReason = 'no_estimate' | 'no_config' | 'unverified_slicer' | 'delta'

export interface TimeConfidence {
  level: ConfidenceLevel
  /** (ours − slicer) / slicer × 100 when an estimate exists. */
  deltaPercent: number | null
  slicer: string | null
  slicerSeconds: number | null
  reason: ApproximateReason | null
}

const MATCH_PERCENT = 1

/** PrusaSlicer 2.5.x, OrcaSlicer 2.4.x, OrcaSlicer 2.5.0-alpha with Klipper/Marlin. */
export function isVerifiedSlicer(slicer: string | null, flavor?: string): boolean {
  if (!slicer) return false
  if (/prusa\s*slicer\s+2\.5\b/i.test(slicer)) return true
  if (/orcaslicer\s+2\.4\b/i.test(slicer)) return true
  if (!/orcaslicer\s+2\.5\.0-alpha/i.test(slicer)) return false
  const code = (flavor ?? '').toLowerCase()
  return (
    code === 'klipper' ||
    code === 'marlin' ||
    code === 'marlin2' ||
    code === 'marlinfirmware'
  )
}

export function timeConfidence(input: {
  oursSeconds: number
  slicer: string | null
  estimatedSeconds: number | null
  config: Record<string, string>
}): TimeConfidence {
  const slicerSeconds =
    input.estimatedSeconds && input.estimatedSeconds > 0 ? input.estimatedSeconds : null
  const deltaPercent =
    slicerSeconds !== null
      ? ((input.oursSeconds - slicerSeconds) / slicerSeconds) * 100
      : null
  const flavor = input.config.gcode_flavor
  const hasConfig = Object.keys(input.config).length > 0
  const verified = isVerifiedSlicer(input.slicer, flavor)

  if (slicerSeconds === null) {
    return {
      level: 'approximate',
      deltaPercent,
      slicer: input.slicer,
      slicerSeconds,
      reason: 'no_estimate',
    }
  }
  if (!hasConfig) {
    return {
      level: 'approximate',
      deltaPercent,
      slicer: input.slicer,
      slicerSeconds,
      reason: 'no_config',
    }
  }
  if (!verified) {
    return {
      level: 'approximate',
      deltaPercent,
      slicer: input.slicer,
      slicerSeconds,
      reason: 'unverified_slicer',
    }
  }
  if (Math.abs(deltaPercent!) > MATCH_PERCENT) {
    return {
      level: 'approximate',
      deltaPercent,
      slicer: input.slicer,
      slicerSeconds,
      reason: 'delta',
    }
  }
  return {
    level: 'verified',
    deltaPercent,
    slicer: input.slicer,
    slicerSeconds,
    reason: null,
  }
}

export function timeConfidenceFromMetadata(
  oursSeconds: number,
  metadata: SlicerMetadata,
): TimeConfidence {
  return timeConfidence({
    oursSeconds,
    slicer: metadata.slicer,
    estimatedSeconds: metadata.estimatedSeconds,
    config: metadata.config,
  })
}
