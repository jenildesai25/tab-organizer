import { describe, expect, it } from 'vitest'
import {
  boundGroupIds,
  groupFingerprint,
  parseGroupFingerprints,
  rebindGroupFingerprints,
  type LiveGroupSnapshot,
} from './group-identity.js'

function live(partial: Partial<LiveGroupSnapshot> & Pick<LiveGroupSnapshot, 'id' | 'title'>): LiveGroupSnapshot {
  return {
    color: 'blue',
    patterns: [],
    ...partial,
  }
}

describe('group fingerprints', () => {
  it('normalizes member pages and drops an empty title', () => {
    expect(groupFingerprint({ title: '  ', urls: [] })).toBeNull()
    expect(
      groupFingerprint({
        title: 'Work',
        color: 'Blue',
        urls: ['https://github.com/acme/repo?q=1', 'https://github.com/acme/repo#x', 'https://example.com/a'],
      }),
    ).toEqual({
      title: 'Work',
      color: 'blue',
      patterns: ['https://example.com/a', 'https://github.com/acme/repo'],
    })
  })

  it('parses stored fingerprints and skips junk', () => {
    expect(parseGroupFingerprints([{ title: 'Work', color: 'grey', patterns: ['https://github.com/acme'] }, null, { title: '' }])).toEqual([
      { title: 'Work', color: 'grey', patterns: ['https://github.com/acme'] },
    ])
  })

  it('rebinds a restored group by title and pages when the id changed', () => {
    const saved = groupFingerprint({
      title: 'Work',
      color: 'blue',
      urls: ['https://github.com/acme/repo', 'https://github.com/acme/other'],
    })
    expect(saved).not.toBeNull()
    const bound = rebindGroupFingerprints(
      [saved!],
      [
        live({ id: 9, title: 'Shopping', patterns: ['https://amazon.com/cart'] }),
        live({ id: 44, title: 'Work', patterns: ['https://github.com/acme/repo'] }),
      ],
    )
    expect(boundGroupIds(bound)).toEqual([44])
    expect(bound[0]?.fingerprint.title).toBe('Work')
  })

  it('does not bind one of two same-titled groups before pages have loaded', () => {
    const saved = groupFingerprint({
      title: 'GitHub',
      urls: ['https://github.com/acme/repo'],
    })!
    const bound = rebindGroupFingerprints(
      [saved],
      [live({ id: 1, title: 'GitHub' }), live({ id: 2, title: 'GitHub' })],
    )
    expect(boundGroupIds(bound)).toEqual([])
    expect(bound).toHaveLength(1)
  })

  it('drops a fingerprint when the group is gone and other pages have loaded', () => {
    const saved = groupFingerprint({
      title: 'Work',
      urls: ['https://github.com/acme/repo'],
    })!
    const bound = rebindGroupFingerprints(
      [saved],
      [live({ id: 3, title: 'Mail', patterns: ['https://mail.google.com/mail'] })],
    )
    expect(bound).toEqual([])
  })
})
