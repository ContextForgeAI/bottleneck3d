import type { EngineSource, EvalJob } from './engine-core'

export type EngineRequest =
  | { id: number; type: 'load'; source: EngineSource }
  | { id: number; type: 'evaluate'; channel?: string; jobs: EvalJob[] }

export type EngineResponse =
  | { id: number; type: 'progress'; value: number }
  | { id: number; type: 'done'; result: unknown }
  | { id: number; type: 'skipped' }
  | { id: number; type: 'error'; message: string }

/** Runs requests one at a time; an evaluate is dropped once a newer one waits on its channel. */
export function createRequestPump(
  handle: (request: EngineRequest, isStale: () => boolean) => Promise<void>,
) {
  const queue: EngineRequest[] = []
  let running = false
  const isStale = (request: EngineRequest) =>
    request.type === 'evaluate' &&
    request.channel !== undefined &&
    queue.some((next) => next.type === 'evaluate' && next.channel === request.channel)

  async function pump() {
    running = true
    while (queue.length) {
      const request = queue.shift()!
      await handle(request, () => isStale(request))
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    running = false
  }

  return (request: EngineRequest) => {
    queue.push(request)
    if (!running) void pump()
  }
}

export function serveEngine(
  core: { load: (source: EngineSource, progress: (value: number) => void) => Promise<unknown>; evaluate: (job: EvalJob) => unknown },
  post: (response: EngineResponse) => void,
) {
  return createRequestPump(async (request, isStale) => {
    const { id } = request
    try {
      if (request.type === 'load') {
        const result = await core.load(request.source, (value) => post({ id, type: 'progress', value }))
        post({ id, type: 'done', result })
        return
      }
      const results: unknown[] = []
      for (let index = 0; index < request.jobs.length; index += 1) {
        if (isStale()) {
          post({ id, type: 'skipped' })
          return
        }
        results.push(core.evaluate(request.jobs[index]))
        if (request.jobs.length > 1) {
          post({ id, type: 'progress', value: (index + 1) / request.jobs.length })
          await new Promise((resolve) => setTimeout(resolve, 0))
        }
      }
      post({ id, type: 'done', result: results })
    } catch (error) {
      post({ id, type: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  })
}
