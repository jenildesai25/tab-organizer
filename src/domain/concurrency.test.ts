import { describe, expect, it } from 'vitest'
import { createAsyncMutex, createSingleFlightGate } from './concurrency.js'

describe('createAsyncMutex', () => {
  it('runs concurrent tasks serially so earlier writes are not lost', async () => {
    const mutex = createAsyncMutex()
    let value = 0
    const order: number[] = []

    const first = mutex.run(async () => {
      const seen = value
      await Promise.resolve()
      value = seen + 1
      order.push(1)
      return value
    })
    const second = mutex.run(async () => {
      const seen = value
      await Promise.resolve()
      value = seen + 10
      order.push(2)
      return value
    })

    await expect(Promise.all([first, second])).resolves.toEqual([1, 11])
    expect(order).toEqual([1, 2])
    expect(value).toBe(11)
  })

  it('continues the chain after a rejected task', async () => {
    const mutex = createAsyncMutex()
    const failed = mutex.run(async () => {
      throw new Error('boom')
    })
    const ok = mutex.run(async () => 'ok')
    await expect(failed).rejects.toThrow('boom')
    await expect(ok).resolves.toBe('ok')
  })
})

describe('createSingleFlightGate', () => {
  it('rejects a second enter until exit', () => {
    const gate = createSingleFlightGate()
    expect(gate.tryEnter()).toBe(true)
    expect(gate.running).toBe(true)
    expect(gate.tryEnter()).toBe(false)
    gate.exit()
    expect(gate.running).toBe(false)
    expect(gate.tryEnter()).toBe(true)
  })
})
