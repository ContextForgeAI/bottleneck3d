import type { PrintWorkload } from './domain/workload.ts'

export type OrcaPresetKind = 'machine' | 'filament' | 'process'

export interface OrcaPreset {
  kind: OrcaPresetKind
  name: string
  /** "User" for own presets, "system" for vendor profiles shipped with Orca. */
  from: string
  instantiable: boolean
  path: string
  values: Record<string, string>
  inherits: string | null
}

export interface OrcaPresetLibrary {
  presets: OrcaPreset[]
  skipped: number
}

export interface ResolvedPreset {
  preset: OrcaPreset
  config: Record<string, string>
  /** Preset names from the selected one up to the furthest parent found. */
  chain: string[]
  /** Parent named by `inherits` but absent from the library (Orca 2.5 keeps system presets in binary .opc). */
  missingParent: string | null
}

const KINDS: OrcaPresetKind[] = ['machine', 'filament', 'process']
const META_KEYS = new Set([
  'name',
  'inherits',
  'from',
  'type',
  'instantiation',
  'setting_id',
  'version',
  'is_custom_defined',
  'base_id',
  'updated_time',
  'user_id',
])

/** Timing-relevant keys shown when a preset differs from the file. */
export const PRESET_TIMING_KEYS = [
  'filament_max_volumetric_speed',
  'filament_diameter',
  'machine_max_speed_x',
  'machine_max_speed_y',
  'machine_max_speed_z',
  'machine_max_speed_e',
  'machine_max_acceleration_x',
  'machine_max_acceleration_y',
  'machine_max_acceleration_z',
  'machine_max_acceleration_e',
  'machine_max_acceleration_extruding',
  'machine_max_acceleration_retracting',
  'machine_max_jerk_x',
  'machine_max_jerk_z',
  'machine_max_jerk_e',
  'machine_max_junction_deviation',
  'gcode_flavor',
] as const

function configValue(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (Array.isArray(value)) {
    const parts = value.map((item) => configValue(item))
    return parts.every((part) => part !== null) ? parts.join(',') : null
  }
  if (typeof value === 'object') return null
  return String(value)
}

function kindFromPath(path: string): OrcaPresetKind | null {
  const parts = path.replace(/\\/g, '/').split('/')
  for (let index = parts.length - 2; index >= 0; index -= 1) {
    const part = parts[index].toLowerCase()
    if ((KINDS as string[]).includes(part)) return part as OrcaPresetKind
  }
  return null
}

/** Written by the Orca plugin action "Bottleneck3D Export Presets". */
export const PLUGIN_EXPORT_FORMAT = 'bottleneck3d-orca-presets'

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** Parses one Orca preset JSON; returns null for anything else (indexes, bundles, .info). */
export function parseOrcaPreset(path: string, text: string): OrcaPreset | null {
  return presetFromRecord(path, parseJson(text))
}

/** A preset file, or every preset in a plugin export; [] for other JSON. */
export function parseOrcaPresetFile(path: string, text: string): OrcaPreset[] {
  const data = parseJson(text) as Record<string, unknown> | null
  if (data && data.format === PLUGIN_EXPORT_FORMAT && Array.isArray(data.presets)) {
    return data.presets
      .map((record, index) => presetFromRecord(`${path}#${index}`, record))
      .filter((preset): preset is OrcaPreset => preset !== null)
  }
  const preset = presetFromRecord(path, data)
  return preset ? [preset] : []
}

function presetFromRecord(path: string, data: unknown): OrcaPreset | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const record = data as Record<string, unknown>
  const name = typeof record.name === 'string' ? record.name : null
  if (!name) return null
  const type = typeof record.type === 'string' ? record.type.toLowerCase() : ''
  const kind = (KINDS as string[]).includes(type)
    ? (type as OrcaPresetKind)
    : kindFromPath(path)
  if (!kind) return null

  const values: Record<string, string> = {}
  for (const [key, raw] of Object.entries(record)) {
    if (META_KEYS.has(key)) continue
    const value = configValue(raw)
    if (value !== null) values[key] = value
  }

  return {
    kind,
    name,
    from: typeof record.from === 'string' ? record.from : '',
    instantiable: record.instantiation !== 'false',
    path,
    values,
    inherits:
      typeof record.inherits === 'string' && record.inherits ? record.inherits : null,
  }
}

/**
 * Builds a library from files picked in the browser. Backups (user_backup-*)
 * are skipped; the first preset of a given kind and name wins.
 */
export function buildOrcaPresetLibrary(
  files: Array<{ path: string; text: string }>,
): OrcaPresetLibrary {
  const byKey = new Map<string, OrcaPreset>()
  let skipped = 0

  for (const file of files) {
    const normalized = file.path.replace(/\\/g, '/')
    if (/(^|\/)user_backup[^/]*\//i.test(normalized)) {
      skipped += 1
      continue
    }
    const presets = parseOrcaPresetFile(normalized, file.text)
    if (!presets.length) {
      skipped += 1
      continue
    }
    // Plugin exports carry Orca's fully resolved configs, so they beat loose files.
    const exported = presets[0].path.includes('#')
    for (const preset of presets) {
      const key = `${preset.kind}\u0000${preset.name}`
      if (exported || !byKey.has(key)) byKey.set(key, preset)
    }
  }

  const presets = [...byKey.values()].sort(
    (a, b) =>
      Number(b.from.toLowerCase() === 'user') - Number(a.from.toLowerCase() === 'user') ||
      a.name.localeCompare(b.name),
  )
  return { presets, skipped }
}

/** Merges the `inherits` chain root-first, so the selected preset wins. */
export function resolveOrcaPreset(
  library: OrcaPresetLibrary,
  preset: OrcaPreset,
): ResolvedPreset {
  const chain: OrcaPreset[] = [preset]
  let missingParent: string | null = null
  let parentName = preset.inherits

  while (parentName) {
    const parent = library.presets.find(
      (candidate) => candidate.kind === preset.kind && candidate.name === parentName,
    )
    if (!parent) {
      missingParent = parentName
      break
    }
    if (chain.includes(parent)) break
    chain.push(parent)
    parentName = parent.inherits
  }

  const config: Record<string, string> = {}
  for (const item of [...chain].reverse()) Object.assign(config, item.values)

  return {
    preset,
    config,
    chain: chain.map((item) => item.name),
    missingParent,
  }
}

export interface PresetChange {
  key: string
  file: string | undefined
  preset: string
}

export function presetTimingChanges(
  fileConfig: Record<string, string>,
  presetConfig: Record<string, string>,
): PresetChange[] {
  const changes: PresetChange[] = []
  for (const key of PRESET_TIMING_KEYS) {
    const preset = presetConfig[key]
    if (preset === undefined || preset === fileConfig[key]) continue
    changes.push({ key, file: fileConfig[key], preset })
  }
  return changes
}

export interface PresetSelection {
  machine: string
  filament: string
}

export const NO_PRESETS: PresetSelection = { machine: '', filament: '' }

/** [machine, filament]; null where nothing is selected or the name is gone. */
export function resolvePresetSelection(
  library: OrcaPresetLibrary | null,
  selection: PresetSelection,
): [ResolvedPreset | null, ResolvedPreset | null] {
  const resolve = (kind: OrcaPresetKind, name: string) => {
    if (!library || !name) return null
    const preset = library.presets.find((item) => item.kind === kind && item.name === name)
    return preset ? resolveOrcaPreset(library, preset) : null
  }
  return [resolve('machine', selection.machine), resolve('filament', selection.filament)]
}

/**
 * Overlays resolved presets on the config block of the file. Keys only a missing
 * system parent would set stay as the file has them.
 */
export function workloadWithPresets(
  workload: PrintWorkload,
  presets: Array<ResolvedPreset | null>,
): PrintWorkload {
  const active = presets.filter((item): item is ResolvedPreset => item !== null)
  if (!active.length) return workload
  const config = { ...workload.slicer.config }
  for (const item of active) Object.assign(config, item.config)
  return { ...workload, slicer: { ...workload.slicer, config } }
}
