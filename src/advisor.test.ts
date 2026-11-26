import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ADVISOR_TIMEOUT_MESSAGE,
  ADVISOR_TIMEOUT_MS,
  ADVISOR_WARMUP_TIMEOUT_MS,
  enqueueAdvisor,
  isAdvisorWarmed,
  resetAdvisorForTests,
  RETITLE_TIMEOUT_MS,
} from './advisor.js'

function hangUntilAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(new DOMException('aborted', 'AbortError'))
      return
    }
    signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {
      once: true,
    })
  })
}

async function expectTimeout(pending: Promise<unknown>): Promise<unknown> {
  // Attach before advancing timers so the rejection is never "unhandled".
  const outcome = pending.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  )
  return outcome
}

describe('advisor timeouts', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetAdvisorForTests()
  })

  afterEach(() => {
    resetAdvisorForTests()
    vi.useRealTimers()
  })

  it('exports generous warm and retitle budgets', () => {
    expect(ADVISOR_WARMUP_TIMEOUT_MS).toBe(120_000)
    expect(ADVISOR_TIMEOUT_MS).toBe(90_000)
    expect(RETITLE_TIMEOUT_MS).toBe(120_000)
  })

  it('uses the warm-up budget on the first call', async () => {
    let sawSignal: AbortSignal | undefined
    const pending = enqueueAdvisor(async (signal) => {
      sawSignal = signal
      return hangUntilAbort(signal)
    })
    const outcome = expectTimeout(pending)

    await vi.advanceTimersByTimeAsync(ADVISOR_WARMUP_TIMEOUT_MS - 1)
    expect(sawSignal?.aborted).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    const result = await outcome
    expect(result).toMatchObject({
      ok: false,
      error: { name: 'TimeoutError', message: ADVISOR_TIMEOUT_MESSAGE },
    })
    expect(isAdvisorWarmed()).toBe(false)
  })

  it('shortens to the warm budget after a successful reply', async () => {
    await enqueueAdvisor(async () => 'ok')
    expect(isAdvisorWarmed()).toBe(true)

    let sawSignal: AbortSignal | undefined
    const pending = enqueueAdvisor(async (signal) => {
      sawSignal = signal
      return hangUntilAbort(signal)
    })
    const outcome = expectTimeout(pending)

    await vi.advanceTimersByTimeAsync(ADVISOR_TIMEOUT_MS - 1)
    expect(sawSignal?.aborted).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    const result = await outcome
    expect(result).toMatchObject({ ok: false, error: { name: 'TimeoutError' } })
  })

  it('honors an explicit retitle timeout override', async () => {
    await enqueueAdvisor(async () => 'warm')

    const pending = enqueueAdvisor((signal) => hangUntilAbort(signal), {
      timeoutMs: RETITLE_TIMEOUT_MS,
    })
    const outcome = expectTimeout(pending)

    await vi.advanceTimersByTimeAsync(ADVISOR_TIMEOUT_MS)
    const mid = await Promise.race([
      outcome.then((result) => ({ settled: true as const, result })),
      Promise.resolve({ settled: false as const }),
    ])
    expect(mid.settled).toBe(false)

    await vi.advanceTimersByTimeAsync(RETITLE_TIMEOUT_MS - ADVISOR_TIMEOUT_MS)
    const result = await outcome
    expect(result).toMatchObject({ ok: false, error: { name: 'TimeoutError' } })
  })
})
