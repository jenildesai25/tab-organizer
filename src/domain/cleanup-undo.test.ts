import { describe, expect, it } from 'vitest'
import {
  CLEANUP_UNDO_TTL_MS,
  buildCleanupUndoSnapshot,
  cleanupUndoHint,
  cleanupUndoIsLive,
  formatCleanupUndoSummary,
  parseCleanupUndoSnapshot,
  resolveCloseableUrl,
} from './cleanup-undo.js'

describe('cleanup undo snapshot', () => {
  it('prefers a real http url over pending', () => {
    expect(resolveCloseableUrl({ url: 'https://github.com/a', pendingUrl: 'https://example.com' })).toBe(
      'https://github.com/a',
    )
    expect(resolveCloseableUrl({ url: 'chrome://newtab', pendingUrl: 'https://example.com' })).toBe(
      'https://example.com',
    )
    expect(resolveCloseableUrl({ url: 'chrome://newtab' })).toBe('')
  })

  it('keeps only confirmed http tabs and remembers their group label', () => {
    const snapshot = buildCleanupUndoSnapshot(
      [
        { id: 1, url: 'https://github.com/acme', title: 'Repo', windowId: 9, groupId: 4 },
        { id: 2, url: 'chrome://extensions', title: 'Ext', windowId: 9 },
        { id: 3, url: 'https://example.com', title: 'Ex', windowId: 9, pinned: true },
      ],
      [{ id: 4, title: 'Work', color: 'Blue' }],
      [1, 3],
      1_000,
      60_000,
    )
    expect(snapshot).toEqual({
      closedAt: 1_000,
      expiresAt: 61_000,
      tabs: [
        {
          url: 'https://github.com/acme',
          title: 'Repo',
          windowId: 9,
          pinned: false,
          groupTitle: 'Work',
          groupColor: 'blue',
        },
        {
          url: 'https://example.com',
          title: 'Ex',
          windowId: 9,
          pinned: true,
          groupTitle: '',
          groupColor: '',
        },
      ],
    })
  })

  it('returns null when nothing reopenable was closed', () => {
    expect(
      buildCleanupUndoSnapshot([{ id: 1, url: 'chrome://newtab' }], [], [1], 1_000),
    ).toBeNull()
    expect(buildCleanupUndoSnapshot([], [], [], 1_000)).toBeNull()
  })

  it('parses a stored snapshot and drops junk', () => {
    expect(
      parseCleanupUndoSnapshot({
        closedAt: 10,
        expiresAt: 20,
        tabs: [{ url: 'https://a.com', title: 'A', windowId: 1, pinned: false, groupTitle: '', groupColor: '' }, null],
      })?.tabs,
    ).toHaveLength(1)
    expect(parseCleanupUndoSnapshot({ closedAt: 10, expiresAt: 20, tabs: [] })).toBeNull()
  })

  it('expires after the ttl and exposes a compact hint', () => {
    const snapshot = buildCleanupUndoSnapshot(
      [{ id: 1, url: 'https://a.com', windowId: 2 }],
      [],
      [1],
      1_000,
      CLEANUP_UNDO_TTL_MS,
    )!
    expect(cleanupUndoIsLive(snapshot, 1_000)).toBe(true)
    expect(cleanupUndoIsLive(snapshot, snapshot.expiresAt)).toBe(false)
    expect(cleanupUndoHint(snapshot, 1_000)).toEqual({ closed: 1, expiresAt: snapshot.expiresAt })
    expect(cleanupUndoHint(snapshot, snapshot.expiresAt)).toBeNull()
  })

  it('formats the reopen summary', () => {
    expect(formatCleanupUndoSummary(1)).toBe('Reopened 1 tab from the last clean-up.')
    expect(formatCleanupUndoSummary(3)).toBe('Reopened 3 tabs from the last clean-up.')
  })
})
