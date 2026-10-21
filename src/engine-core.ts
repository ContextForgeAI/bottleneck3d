import {
  evaluateWorkload,
  inferTypicalExtrusionSpeed,
  parseGcodeFile,
  parseGcodeText,
  type FeedPolicy,
} from './analyzer'
import type { PrinterSettings } from './domain/profile'
import type { AnalysisResult } from './domain/result'
import type { PrintWorkload } from './domain/workload'

export type EngineSource = { kind: 'file'; file: File } | { kind: 'text'; text: string }

/** Parsed workload without segments: the segments stay inside the engine. */
export type WorkloadMeta = Omit<PrintWorkload, 'segments'>

export interface LoadedWorkload {
  meta: WorkloadMeta
  typicalSpeed: number
}

export interface EvalJob {
  profile: PrinterSettings
  policy: FeedPolicy
  typicalSpeed?: number
  /** Preset keys laid over the G-code config block. */
  config?: Record<string, string> | null
}

export class EngineCore {
  private workload: PrintWorkload | null = null

  async load(source: EngineSource, onProgress?: (fraction: number) => void): Promise<LoadedWorkload> {
    const workload =
      source.kind === 'file'
        ? await parseGcodeFile(source.file, onProgress)
        : parseGcodeText(source.text, undefined, onProgress)
    this.workload = workload
    const meta: Partial<PrintWorkload> = { ...workload }
    delete meta.segments
    return { meta: meta as WorkloadMeta, typicalSpeed: inferTypicalExtrusionSpeed(workload) }
  }

  evaluate(job: EvalJob): AnalysisResult {
    const workload = this.workload
    if (!workload) throw new Error('No G-code loaded')
    const effective = job.config
      ? { ...workload, slicer: { ...workload.slicer, config: { ...workload.slicer.config, ...job.config } } }
      : workload
    return evaluateWorkload(effective, job.profile, job.policy, job.typicalSpeed)
  }
}
