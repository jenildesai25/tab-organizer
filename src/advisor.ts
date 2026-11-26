const TIMEOUT_MS = 8000

let tail: Promise<void> = Promise.resolve()
let generation = 0
let active: AbortController | null = null

/** Drops a reply that is still in flight and any request waiting behind it. */
export function cancelAdvisor(): void {
  generation += 1
  active?.abort()
}

/** One model call at a time. A cancelled generation resolves to null. */
export function enqueueAdvisor<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T | null> {
  const ticket = generation
  const result = tail.then(async () => {
    if (ticket !== generation) return null
    const controller = new AbortController()
    active = controller
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      const value = await run(controller.signal)
      if (ticket !== generation) return null
      return value
    } catch {
      return null
    } finally {
      clearTimeout(timer)
      if (active === controller) active = null
    }
  })
  tail = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}
