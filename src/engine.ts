import type { AnalysisResult } from './domain/result'
import { EngineCore, type EngineSource, type EvalJob, type LoadedWorkload } from './engine-core'
import { serveEngine, type EngineRequest, type EngineResponse } from './engine-protocol'
// Inline: the Orca plugin tab is one HTML file, a separate worker chunk would not resolve.
import EngineWorker from './engine.worker.ts?worker&inline'

export type { EngineSource, EvalJob, LoadedWorkload, WorkloadMeta } from './engine-core'

export interface EngineActivity {
  /** Parse progress 0..1 while a file loads, otherwise null. */
  loading: number | null
  /** Channels with an evaluation in flight, with batch progress 0..1. */
  computing: Record<string, number>
}

export interface Engine {
  load(source: EngineSource): Promise<LoadedWorkload>
  /** Resolves null when a newer request on the same channel or a new file superseded it. */
  evaluate(jobs: EvalJob[], channel: string): Promise<AnalysisResult[] | null>
  subscribe(listener: () => void): () => void
  activity(): EngineActivity
}

interface Pending {
  resolve(value: unknown): void
  reject(error: Error): void
  channel?: string
  generation: number
}

export function createEngine(): Engine {
  let transport: ((request: EngineRequest) => void) | null = null
  const pending = new Map<number, Pending>()
  const latest = new Map<string, number>()
  const listeners = new Set<() => void>()
  let nextId = 1
  let generation = 0
  let state: EngineActivity = { loading: null, computing: {} }

  const setState = (next: EngineActivity) => {
    state = next
    listeners.forEach((listener) => listener())
  }
  const setComputing = (channel: string, value: number | null) => {
    const computing = { ...state.computing }
    if (value === null) delete computing[channel]
    else computing[channel] = value
    setState({ ...state, computing })
  }

  const receive = (response: EngineResponse) => {
    const entry = pending.get(response.id)
    if (!entry) return
    if (response.type === 'progress') {
      if (entry.channel) setComputing(entry.channel, response.value)
      else setState({ ...state, loading: response.value })
      return
    }
    pending.delete(response.id)
    const current =
      entry.generation === generation &&
      (!entry.channel || latest.get(entry.channel) === response.id)
    if (entry.channel && latest.get(entry.channel) === response.id) {
      latest.delete(entry.channel)
      setComputing(entry.channel, null)
    }
    if (!entry.channel) setState({ ...state, loading: null })
    if (response.type === 'error') entry.reject(new Error(response.message))
    else entry.resolve(response.type === 'done' && current ? response.result : null)
  }

  const send = (request: EngineRequest) => {
    if (!transport) {
      if (typeof Worker === 'undefined') {
        transport = serveEngine(new EngineCore(), receive)
      } else {
        const worker = new EngineWorker()
        worker.onmessage = (event: MessageEvent<EngineResponse>) => receive(event.data)
        transport = (message) => worker.postMessage(message)
      }
    }
    transport(request)
  }

  return {
    load(source) {
      generation += 1
      const id = nextId++
      latest.clear()
      setState({ loading: 0, computing: {} })
      return new Promise<LoadedWorkload>((resolve, reject) => {
        pending.set(id, { resolve: resolve as (value: unknown) => void, reject, generation })
        send({ id, type: 'load', source })
      })
    },
    evaluate(jobs, channel) {
      const id = nextId++
      latest.set(channel, id)
      setComputing(channel, 0)
      return new Promise<AnalysisResult[] | null>((resolve, reject) => {
        pending.set(id, { resolve: resolve as (value: unknown) => void, reject, channel, generation })
        send({ id, type: 'evaluate', channel, jobs })
      })
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    activity: () => state,
  }
}
