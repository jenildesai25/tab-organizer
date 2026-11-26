import { describe, expect, it } from 'vitest'
import {
  boundGroupIds,
  groupFingerprint,
  omitGroupBinding,
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
    expect(bound[0]?.fingerprint.patterns).toEqual([
      'https://github.com/acme/other',
      'https://github.com/acme/repo',
    ])
  })

  it('does not pick a winner when two groups match equally', () => {
    const saved = groupFingerprint({
      title: 'Work',
      urls: ['https://github.com/acme/repo', 'https://example.com/a'],
    })!
    const bound = rebindGroupFingerprints(
      [saved],
      [
        live({ id: 2, title: 'Work', patterns: ['https://github.com/acme/repo'] }),
        live({ id: 1, title: 'Work', patterns: ['https://example.com/a'] }),
      ],
    )
    expect(boundGroupIds(bound)).toEqual([])
    expect(bound[0]?.fingerprint).toEqual(saved)
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

  it('drops an unbound fingerprint when that unique group is unprotected', () => {
    const saved = groupFingerprint({ title: 'Work', urls: ['https://github.com/acme/repo'] })!
    const snapshot = live({ id: 8, title: 'Work' })
    const kept = omitGroupBinding([{ id: null, fingerprint: saved }], 8, snapshot, [snapshot])
    expect(kept).toEqual([])
  })

  it('keeps an unbound fingerprint when another live group shares the title', () => {
    const saved = groupFingerprint({ title: 'Work', urls: ['https://github.com/acme/repo'] })!
    const removed = live({ id: 8, title: 'Work' })
    const other = live({ id: 9, title: 'Work' })
    const kept = omitGroupBinding([{ id: null, fingerprint: saved }], 8, removed, [other])
    expect(kept.map((row) => row.fingerprint)).toEqual([saved])
  })
})
