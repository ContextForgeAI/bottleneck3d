/**
 * Разворачивает user-пресеты Voron в плоские JSON без `inherits`.
 * Источник — экспорт плагина bottleneck3d-presets.json (уже resolved).
 *
 * Запуск: node demo/accuracy-sweep/flatten-presets.ts [outdir]
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const ORCA_EXE = 'C:\\Program Files\\OrcaSlicer\\orca-slicer.exe'
export const TEMP_ROOT = path.join(os.tmpdir(), 'b3d-sweep')

const WANTED = {
  machine: 'Voron 2.4 R2 300 0.4',
  process: 'Voron 0.20 Verify Cube',
  filament: 'Voron PLA Star Plast',
} as const

export const FLAT_NAMES = {
  machine: 'B3D Sweep Machine',
  process: 'B3D Sweep Process',
  filament: 'B3D Sweep Filament',
} as const

export const MODELS: Array<{ id: string; src: string; dest: string; scale?: number }> = [
  {
    id: 'cube',
    src: 'C:\\Users\\Developer\\Downloads\\XYZ 20mm Calibration Cube - 1278865\\files\\xyzCalibration_cube.stl',
    dest: 'cube.stl',
  },
  {
    id: 'quartz',
    src: 'C:\\Users\\Developer\\Downloads\\Quartz_Pot.stl',
    dest: 'quartz_pot.stl',
  },
  {
    id: 'dragon',
    src: 'C:\\Users\\Developer\\Downloads\\DragonScalePot.stl',
    dest: 'dragon_scale_pot.stl',
  },
  {
    id: 'penholder',
    src: 'C:\\Users\\Developer\\Downloads\\Voron_Cube_Penholder.3mf',
    dest: 'penholder.3mf',
  },
]

function pluginExportPath(): string {
  const base = path.join(
    process.env.APPDATA ?? '',
    'OrcaSlicer',
    'orca_plugins',
    'plugin_data',
  )
  const globRoot = base
  const fallback = path.join(
    globRoot,
    'bottleneck3d_orca-0.2.0-py3-none-any',
    'bottleneck3d-presets.json',
  )
  if (existsSync(fallback)) return fallback
  throw new Error(`Не найден bottleneck3d-presets.json (ждали ${fallback})`)
}

export type PresetJson = Record<string, unknown>

export interface FlatPresets {
  machine: PresetJson
  process: PresetJson
  filament: PresetJson
  dir: string
}

function flattenRecord(preset: PresetJson, kind: keyof typeof WANTED): PresetJson {
  const out: PresetJson = { ...preset }
  delete out.inherits
  out.from = 'User'
  out.instantiation = 'true'
  out.name = FLAT_NAMES[kind]
  if (kind === 'machine') {
    out.printer_settings_id = FLAT_NAMES.machine
  }
  if (kind === 'process') {
    out.compatible_printers = []
    out.print_settings_id = FLAT_NAMES.process
  }
  if (kind === 'filament') {
    out.compatible_printers = []
    out.filament_settings_id = [FLAT_NAMES.filament]
  }
  return out
}

export function flattenPresets(outDir = path.join(TEMP_ROOT, 'flat')): FlatPresets {
  mkdirSync(outDir, { recursive: true })
  const data = JSON.parse(readFileSync(pluginExportPath(), 'utf8')) as {
    presets: Array<PresetJson & { type?: string; name?: string }>
  }
  const found: Partial<Record<keyof typeof WANTED, PresetJson>> = {}
  for (const preset of data.presets) {
    const kind = (Object.keys(WANTED) as Array<keyof typeof WANTED>).find(
      (key) => preset.type === key && preset.name === WANTED[key],
    )
    if (kind) found[kind] = preset
  }
  const missing = (Object.keys(WANTED) as Array<keyof typeof WANTED>).filter((key) => !found[key])
  if (missing.length) {
    throw new Error(`В экспорте плагина нет пресетов: ${missing.join(', ')}`)
  }
  const machine = flattenRecord(found.machine!, 'machine')
  const process = flattenRecord(found.process!, 'process')
  const filament = flattenRecord(found.filament!, 'filament')
  writeFileSync(path.join(outDir, 'machine.json'), JSON.stringify(machine, null, '\t'))
  writeFileSync(path.join(outDir, 'process.json'), JSON.stringify(process, null, '\t'))
  writeFileSync(path.join(outDir, 'filament.json'), JSON.stringify(filament, null, '\t'))
  return { machine, process, filament, dir: outDir }
}

export function prepareModels(outDir = path.join(TEMP_ROOT, 'models')): string {
  mkdirSync(outDir, { recursive: true })
  for (const model of MODELS) {
    if (!existsSync(model.src)) {
      console.warn(`модель не найдена: ${model.src}`)
      continue
    }
    copyFileSync(model.src, path.join(outDir, model.dest))
  }
  return outDir
}

if (import.meta.filename === process.argv[1] || process.argv[1]?.endsWith('flatten-presets.ts')) {
  const dir = process.argv[2] ?? path.join(TEMP_ROOT, 'flat')
  const result = flattenPresets(dir)
  prepareModels()
  console.log(`плоские пресеты: ${result.dir}`)
  console.log(`machine keys=${Object.keys(result.machine).length} process=${Object.keys(result.process).length} filament=${Object.keys(result.filament).length}`)
}
