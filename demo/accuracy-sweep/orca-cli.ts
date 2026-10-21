/**
 * Обёртка над консольным OrcaSlicer. GUI-exe, поэтому stdout часто пустой:
 * успех = наличие plate_1.gcode с "; estimated printing time (normal mode)".
 *
 * Рабочая команда (проверено на 2.5.0-alpha):
 *   orca-slicer.exe --slice 0 --arrange 1 --allow-newer-file
 *     --load-settings machine.json --load-settings process.json
 *     --load-filaments filament.json --outputdir OUT model.stl
 *
 * Не использовать --datadir и --export-3mf с абсолютным путём.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { FLAT_NAMES, ORCA_EXE, type PresetJson } from './flatten-presets.ts'

export interface SliceRequest {
  modelPath: string
  outputDir: string
  machine: PresetJson
  process: PresetJson
  filament: PresetJson
  timeoutMs?: number
  scale?: number
}

export interface SliceResult {
  ok: boolean
  gcodePath: string | null
  elapsedMs: number
  exitCode: number | null
  stderr: string
  stdout: string
  args: string[]
  killed: boolean
}

function pair(value: number | string): string {
  return `${value},${value}`
}

export function setScalar(preset: PresetJson, key: string, value: number | string): void {
  const current = preset[key]
  if (typeof current === 'string' && current.includes(',')) {
    preset[key] = pair(value)
    return
  }
  if (Array.isArray(current)) {
    preset[key] = current.map(() => String(value))
    return
  }
  preset[key] = String(value)
}

export function scaleScalar(preset: PresetJson, key: string, k: number): void {
  const raw = preset[key]
  const text = Array.isArray(raw) ? String(raw[0]) : String(raw ?? '')
  const number = Number(text.split(',')[0])
  if (!Number.isFinite(number)) {
    throw new Error(`не число в ${key}: ${text}`)
  }
  setScalar(preset, key, Number((number * k).toFixed(4)))
}

export function clonePreset(preset: PresetJson): PresetJson {
  return JSON.parse(JSON.stringify(preset)) as PresetJson
}

function killTree(pid: number): void {
  spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
    windowsHide: true,
    stdio: 'ignore',
  })
}

export function runOrca(args: string[], timeoutMs: number): Promise<{
  code: number | null
  stdout: string
  stderr: string
  elapsedMs: number
  killed: boolean
}> {
  return new Promise((resolve, reject) => {
    if (!existsSync(ORCA_EXE)) {
      reject(new Error(`нет Orca: ${ORCA_EXE}`))
      return
    }
    const started = Date.now()
    const child = spawn(ORCA_EXE, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let killed = false
    let settled = false
    const timer = setTimeout(() => {
      killed = true
      if (child.pid) killTree(child.pid)
      child.kill()
    }, timeoutMs)
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({
        code,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        elapsedMs: Date.now() - started,
        killed,
      })
    })
  })
}

function findGcode(dir: string): string | null {
  if (!existsSync(dir)) return null
  const names = readdirSync(dir).filter((name) => name.toLowerCase().endsWith('.gcode'))
  const preferred = names.find((name) => /^plate_\d+\.gcode$/i.test(name)) ?? names[0]
  return preferred ? path.join(dir, preferred) : null
}

export function gcodeHasEstimate(gcodePath: string): boolean {
  const text = readFileSync(gcodePath, 'utf8')
  return /estimated printing time \(normal mode\)/i.test(text)
}

export async function sliceWithOrca(request: SliceRequest): Promise<SliceResult> {
  mkdirSync(request.outputDir, { recursive: true })
  const machinePath = path.join(request.outputDir, 'machine.json')
  const processPath = path.join(request.outputDir, 'process.json')
  const filamentPath = path.join(request.outputDir, 'filament.json')
  const machine = clonePreset(request.machine)
  const process = clonePreset(request.process)
  const filament = clonePreset(request.filament)
  machine.name = FLAT_NAMES.machine
  machine.printer_settings_id = FLAT_NAMES.machine
  process.name = FLAT_NAMES.process
  process.print_settings_id = FLAT_NAMES.process
  process.compatible_printers = []
  filament.name = FLAT_NAMES.filament
  filament.filament_settings_id = [FLAT_NAMES.filament]
  filament.compatible_printers = []
  writeFileSync(machinePath, JSON.stringify(machine, null, '\t'))
  writeFileSync(processPath, JSON.stringify(process, null, '\t'))
  writeFileSync(filamentPath, JSON.stringify(filament, null, '\t'))

  const args = [
    '--slice',
    '0',
    '--arrange',
    '1',
    '--allow-newer-file',
    '--load-settings',
    machinePath,
    '--load-settings',
    processPath,
    '--load-filaments',
    filamentPath,
    '--outputdir',
    request.outputDir,
  ]
  if (request.scale && request.scale !== 1) {
    args.push('--scale', String(request.scale))
  }
  args.push(request.modelPath)

  const run = await runOrca(args, request.timeoutMs ?? 180_000)
  const gcodePath = findGcode(request.outputDir)
  const ok = Boolean(gcodePath && gcodeHasEstimate(gcodePath) && !run.killed)
  return {
    ok,
    gcodePath: ok ? gcodePath : gcodePath,
    elapsedMs: run.elapsedMs,
    exitCode: run.code,
    stderr: run.stderr,
    stdout: run.stdout,
    args,
    killed: run.killed,
  }
}

export function clearDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
}
