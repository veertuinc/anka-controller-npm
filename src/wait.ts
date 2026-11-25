import { ControllerError } from './errors'
import type { Instance, WaitForOptions, WaitForResult } from './types'

const DEFAULT_INTERVAL_MS = 3000
const FAILED_STATES = new Set(['Error', 'Terminating', 'Terminated'])

export async function waitForInstance(
  getInstance: (id: string) => Promise<Instance>,
  id: string,
  options: WaitForOptions = {}
): Promise<WaitForResult> {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS
  const timeoutMs = options.timeoutMs ?? 0
  const isReady = options.isReady ?? (instance => instance.instance_state === 'Started')
  const isFailed =
    options.isFailed ??
    (instance => !!instance.instance_state && FAILED_STATES.has(instance.instance_state))
  const isStop = options.isStop ?? (() => false)
  const startedAt = Date.now()
  const requestPath = `/api/v1/vm?id=${encodeURIComponent(id)}`

  for (;;) {
    const instance = await getInstance(id)
    options.onPoll?.(instance)

    if (isFailed(instance)) {
      throw new ControllerError({
        message: formatFailure(instance),
        method: 'GET',
        path: requestPath,
        controllerStatus: instance.instance_state,
        instance
      })
    }

    if (isReady(instance)) {
      return { done: 'ready', instance }
    }

    if (isStop(instance)) {
      return { done: 'stop', instance }
    }

    if (timeoutMs > 0 && Date.now() - startedAt >= timeoutMs) {
      const state = instance.instance_state ?? 'unknown'
      throw new ControllerError({
        message: `Timed out after ${timeoutMs}ms waiting for instance ${id} (instance_state: ${state})`,
        method: 'GET',
        path: requestPath,
        controllerStatus: state,
        instance
      })
    }

    await delay(intervalMs)
  }
}

function formatFailure(instance: Instance): string {
  const state = instance.instance_state ?? 'unknown'
  let text = `Instance entered ${state} state`
  if (typeof instance.message === 'string' && instance.message) {
    text += `: ${instance.message}`
  }

  const stderr = instance.startup_script?.stderr
  if (typeof stderr === 'string' && stderr) {
    text += `: ${stderr}`
  }

  return text
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}
