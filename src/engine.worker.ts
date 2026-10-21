/// <reference lib="webworker" />
import { EngineCore } from './engine-core'
import { serveEngine, type EngineRequest } from './engine-protocol'

const scope = self as unknown as DedicatedWorkerGlobalScope
const enqueue = serveEngine(new EngineCore(), (response) => scope.postMessage(response))

scope.onmessage = (event: MessageEvent<EngineRequest>) => enqueue(event.data)
