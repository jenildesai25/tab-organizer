import { describe, expect, it } from 'vitest'
import { formatRetitleResultLine } from './retitle-results.js'

describe('formatRetitleResultLine', () => {
  it('formats renamed groups as old → new', () => {
    expect(
      formatRetitleResultLine({
        groupId: 1,
        oldTitle: 'GitHub',
        newTitle: 'Code',
        status: 'renamed',
      }),
    ).toBe('GitHub → Code')
  })

  it('formats skip reasons after an em dash', () => {
    expect(
      formatRetitleResultLine({
        groupId: 2,
        oldTitle: 'Local',
        status: 'skipped',
        reason: 'already clear',
      }),
    ).toBe('Local — already clear')
    expect(
      formatRetitleResultLine({
        groupId: 3,
        oldTitle: 'Messy tabs',
        status: 'skipped',
        reason: 'Low confidence',
      }),
    ).toBe('Messy tabs — Low confidence')
    expect(
      formatRetitleResultLine({
        groupId: 4,
        oldTitle: 'Work',
        status: 'skipped',
        reason: 'Shared',
      }),
    ).toBe('Work — Shared')
    expect(
      formatRetitleResultLine({
        groupId: 5,
        oldTitle: '',
        status: 'skipped',
        reason: 'Shared',
      }),
    ).toBe('Shared — skipped')
  })

  it('formats failures with the error reason', () => {
    expect(
      formatRetitleResultLine({
        groupId: 6,
        oldTitle: 'Docs',
        status: 'failed',
        reason: 'Ollama is not running.',
      }),
    ).toBe('Docs — Ollama is not running.')
  })
})
