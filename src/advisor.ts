/** Cold start / first call after service-worker wake — large models need time to load. */
export const ADVISOR_WARMUP_TIMEOUT_MS = 120_000
/** Subsequent calls while weights are still resident. */
export const ADVISOR_TIMEOUT_MS = 90_000

/** Retitle calls can include slow reasoning models; keep each attempt generous. */
export const RETITLE_TIMEOUT_MS = 120_000

export const ADVISOR_TIMEOUT_MESSAGE =
  'Ollama timed out. The model may still be loading — wait and try again, or pick a smaller model.'

let tail: Promise<void> = Promise.resolve()
let generation = 0
let active: AbortController | null = null
/** True after at least one successful model reply in this service-worker lifetime. */
let warmed = false

export function isAdvisorWarmed(): boolean {
  return warmed
}

/** Drops a reply that is still in flight and any request waiting behind it. */
export function cancelAdvisor(): void {
  generation += 1
  active?.abort()
}

/** Test helper: drop in-flight work and treat the next call as a cold start again. */
export function resetAdvisorForTests(): void {
  cancelAdvisor()
  warmed = false
  tail = Promise.resolve()
}

export type EnqueueAdvisorOptions = {
  /** Override the warm/cold default. */
  timeoutMs?: number
}

/** One model call at a time. A cancelled generation resolves to null; other failures throw. */
export function enqueueAdvisor<T>(
  run: (signal: AbortSignal) => Promise<T>,
  options?: EnqueueAdvisorOptions,
): Promise<T | null> {
  const ticket = generation
  const previous = tail
  let release!: () => void
  tail = new Promise<void>((resolve) => {
    release = resolve
  })

  return (async () => {
    await previous
    try {
      if (ticket !== generation) return null
      const controller = new AbortController()
      active = controller
      const timeoutMs = options?.timeoutMs ?? (warmed ? ADVISOR_TIMEOUT_MS : ADVISOR_WARMUP_TIMEOUT_MS)
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const value = await run(controller.signal)
        if (ticket !== generation) return null
        warmed = true
        return value
      } catch (error) {
        if (ticket !== generation) return null
        if (controller.signal.aborted) {
          const timeout = new Error(ADVISOR_TIMEOUT_MESSAGE)
          timeout.name = 'TimeoutError'
          throw timeout
        }
        throw error
      } finally {
        clearTimeout(timer)
        if (active === controller) active = null
      }
    } finally {
      release()
    }
  })()
}
