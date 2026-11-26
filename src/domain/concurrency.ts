/** Serialize async work so concurrent callers run one-at-a-time (load→mutate→set). */
export function createAsyncMutex(): {
  run<T>(task: () => Promise<T>): Promise<T>
} {
  let tail: Promise<unknown> = Promise.resolve()
  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      const next = tail.then(task, task)
      tail = next.then(
        () => undefined,
        () => undefined,
      )
      return next
    },
  }
}

/** Single-flight gate: first caller enters, later callers are rejected until exit. */
export function createSingleFlightGate(): {
  tryEnter(): boolean
  exit(): void
  readonly running: boolean
} {
  let running = false
  return {
    tryEnter() {
      if (running) return false
      running = true
      return true
    },
    exit() {
      running = false
    },
    get running() {
      return running
    },
  }
}
