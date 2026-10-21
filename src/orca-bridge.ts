/** Page side of the Orca plugin bridge (`window.orca`, injected by OrcaSlicer 2.5). */

import type { PrinterSettings } from './domain/profile'
import type { EnvelopeBreach } from './domain/result'

export interface OrcaGcodeInfo {
  name: string
  size: number
  modified: number
}

export interface OrcaStatus {
  version: string
  gcode: OrcaGcodeInfo | null
  presets: boolean
  reslice?: boolean
}

export interface OrcaFile {
  kind: 'gcode' | 'presets'
  name: string
  text: string
}

/** Upgrade levers sent to `b3d.reslice`; mirrors the instant what-if profile. */
export interface ResliceChanges {
  accelerationScale?: number
  printSpeedScale?: number
  maxVolumetricFlow?: number
  minimumLayerTime?: number
  raiseMachineAcceleration?: boolean
  raiseMachineSpeed?: boolean
  raiseMachineSpeedTo?: number
}

export interface ResliceResult {
  seconds: number
  baselineSeconds: number
  elapsedMs: number
  gcodeName?: string
}

interface OrcaHost {
  postMessage(data: unknown): void
  onMessage(callback: (data: unknown) => void): void
}

type Incoming =
  | ({ type: 'b3d.status' } & OrcaStatus)
  | { type: 'b3d.begin'; request: number; kind: OrcaFile['kind']; name: string; chunks: number }
  | { type: 'b3d.chunk'; request: number; index: number; data: string }
  | { type: 'b3d.end'; request: number }
  | { type: 'b3d.error'; request: number; message: string }
  | {
      type: 'b3d.reslice-result'
      request: number
      ok: boolean
      seconds?: number
      baselineSeconds?: number
      elapsedMs?: number
      gcodeName?: string
      message?: string
    }

interface PendingFile {
  kind: 'file'
  resolve(file: OrcaFile): void
  reject(error: Error): void
  fileKind?: OrcaFile['kind']
  name?: string
  parts: string[]
}

interface PendingReslice {
  kind: 'reslice'
  resolve(result: ResliceResult): void
  reject(error: Error): void
}

type Pending = PendingFile | PendingReslice

export interface OrcaBridge {
  hello(): void
  request(kind: OrcaFile['kind']): Promise<OrcaFile>
  reslice(changes: ResliceChanges): Promise<ResliceResult>
}

const SCALE_EPS = 1e-6

export function resliceChangesFromProfiles(
  reference: PrinterSettings,
  virtual: PrinterSettings,
  envelope: EnvelopeBreach[] = [],
): ResliceChanges | null {
  const changes: ResliceChanges = {}
  if (reference.acceleration > 0 && Math.abs(virtual.acceleration - reference.acceleration) > 0.5) {
    changes.accelerationScale = virtual.acceleration / reference.acceleration
  }
  if (reference.maxPrintSpeed > 0 && Math.abs(virtual.maxPrintSpeed - reference.maxPrintSpeed) > 0.5) {
    changes.printSpeedScale = virtual.maxPrintSpeed / reference.maxPrintSpeed
  }
  if (Math.abs(virtual.maxVolumetricFlow - reference.maxVolumetricFlow) > 1e-6) {
    changes.maxVolumetricFlow = virtual.maxVolumetricFlow
  }
  if (Math.abs(virtual.minimumLayerTime - reference.minimumLayerTime) > 1e-6) {
    changes.minimumLayerTime = virtual.minimumLayerTime
  }
  for (const breach of envelope) {
    if (breach.limit === 'machine_max_acceleration') changes.raiseMachineAcceleration = true
    if (breach.limit === 'machine_max_speed') {
      changes.raiseMachineSpeed = true
      changes.raiseMachineSpeedTo = breach.to
    }
  }
  if (changes.accelerationScale !== undefined && changes.accelerationScale > 1 + SCALE_EPS) {
    changes.raiseMachineAcceleration = true
  }
  if (changes.accelerationScale !== undefined && Math.abs(changes.accelerationScale - 1) < SCALE_EPS) {
    delete changes.accelerationScale
    delete changes.raiseMachineAcceleration
  }
  if (changes.printSpeedScale !== undefined && Math.abs(changes.printSpeedScale - 1) < SCALE_EPS) {
    delete changes.printSpeedScale
  }
  return Object.keys(changes).length ? changes : null
}

export function resliceChangesKey(changes: ResliceChanges | null): string {
  return JSON.stringify(changes)
}

function orcaHost(): OrcaHost | null {
  const host = (window as { orca?: Partial<OrcaHost> }).orca
  return host && typeof host.postMessage === 'function' && typeof host.onMessage === 'function'
    ? (host as OrcaHost)
    : null
}

export function isInsideOrca(): boolean {
  return orcaHost() !== null
}

/** Null outside Orca; `onStatus` fires for every status reply. */
export function connectOrca(onStatus: (status: OrcaStatus) => void): OrcaBridge | null {
  const host = orcaHost()
  if (!host) return null
  const pending = new Map<number, Pending>()
  let nextRequest = 1

  host.onMessage((raw) => {
    const message = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Incoming | null
    if (!message || typeof message !== 'object') return
    if (message.type === 'b3d.status') {
      onStatus({
        version: message.version,
        gcode: message.gcode,
        presets: message.presets,
        reslice: Boolean(message.reslice),
      })
      return
    }
    const entry = pending.get(message.request)
    if (!entry) return
    if (entry.kind === 'reslice') {
      if (message.type === 'b3d.reslice-result') {
        pending.delete(message.request)
        if (!message.ok || message.seconds === undefined || message.baselineSeconds === undefined) {
          entry.reject(new Error(message.message || 'reslice failed'))
        } else {
          entry.resolve({
            seconds: message.seconds,
            baselineSeconds: message.baselineSeconds,
            elapsedMs: message.elapsedMs ?? 0,
            gcodeName: message.gcodeName,
          })
        }
      } else if (message.type === 'b3d.error') {
        pending.delete(message.request)
        entry.reject(new Error(message.message))
      }
      return
    }
    if (message.type === 'b3d.begin') {
      entry.fileKind = message.kind
      entry.name = message.name
      entry.parts = new Array<string>(message.chunks).fill('')
    } else if (message.type === 'b3d.chunk') {
      entry.parts[message.index] = message.data
    } else if (message.type === 'b3d.end') {
      pending.delete(message.request)
      entry.resolve({
        kind: entry.fileKind ?? 'gcode',
        name: entry.name ?? '',
        text: entry.parts.join(''),
      })
    } else if (message.type === 'b3d.error') {
      pending.delete(message.request)
      entry.reject(new Error(message.message))
    }
  })

  return {
    hello: () => host.postMessage({ type: 'b3d.hello' }),
    request: (kind) =>
      new Promise<OrcaFile>((resolve, reject) => {
        const request = nextRequest++
        pending.set(request, { kind: 'file', resolve, reject, parts: [] })
        host.postMessage({ type: kind === 'gcode' ? 'b3d.get-gcode' : 'b3d.get-presets', request })
      }),
    reslice: (changes) =>
      new Promise<ResliceResult>((resolve, reject) => {
        const request = nextRequest++
        pending.set(request, { kind: 'reslice', resolve, reject })
        host.postMessage({ type: 'b3d.reslice', request, changes })
      }),
  }
}
