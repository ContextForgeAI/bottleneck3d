export type Confidence = 'high' | 'medium' | 'low' | 'unknown'

export type ProfileSource =
  | 'gcode_command'
  | 'orca_resolved_profile'
  | 'gcode_metadata'
  | 'local_calibration'
  | 'manual_override'
  | 'unknown'

export interface ProfileField<T> {
  value: T
  source: ProfileSource
  confidence: Confidence
  key?: string
  notes?: string[]
}

export function profileField<T>(
  value: T,
  source: ProfileSource,
  confidence: Confidence,
  key?: string,
  notes?: string[],
): ProfileField<T> {
  return {
    value,
    source,
    confidence,
    key,
    notes,
  }
}
