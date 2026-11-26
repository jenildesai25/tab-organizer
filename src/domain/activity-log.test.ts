import { describe, expect, it } from 'vitest'
import {
  ACTIVITY_LOG_CAP,
  appendActivityEntry,
  createActivityEntry,
  filterActivityByActor,
  filterActivityByFilter,
  formatActivityLine,
  formatActivityTime,
  parseStoredActivityLog,
  trimActivityLog,
  type ActivityEntry,
} from './activity-log.js'

function entry(partial: Partial<ActivityEntry> & Pick<ActivityEntry, 'action' | 'actor'>): ActivityEntry {
  return createActivityEntry(
    {
      oldTitle: 'Cloud',
      newTitle: 'Bug Reports',
      groupTitle: 'Bug Reports',
      groupId: 7,
      ...partial,
    },
    partial.ts ?? 1_700_000_000_000,
    partial.id ?? 'e1',
  )
}

describe('trimActivityLog', () => {
  it('keeps the newest entries within the cap', () => {
    const rows = Array.from({ length: 5 }, (_, index) =>
      entry({ id: `e${index}`, ts: index, action: 'group.rename', actor: 'ai' }),
    )
    expect(trimActivityLog(rows, 3).map((row) => row.id)).toEqual(['e0', 'e1', 'e2'])
  })

  it('returns a copy when under the cap', () => {
    const rows = [entry({ action: 'group.rename', actor: 'user' })]
    const trimmed = trimActivityLog(rows, 10)
    expect(trimmed).toEqual(rows)
    expect(trimmed).not.toBe(rows)
  })
})

describe('appendActivityEntry', () => {
  it('prepends and trims to the default cap', () => {
    const existing = Array.from({ length: ACTIVITY_LOG_CAP }, (_, index) =>
      entry({ id: `old-${index}`, ts: index, action: 'tab.file', actor: 'sweep' }),
    )
    const next = appendActivityEntry(
      existing,
      { actor: 'ai', action: 'group.rename', oldTitle: 'Cloud', newTitle: 'Bug Reports' },
      { id: 'fresh', now: 99 },
    )
    expect(ACTIVITY_LOG_CAP).toBe(500)
    expect(next).toHaveLength(ACTIVITY_LOG_CAP)
    expect(next[0]?.id).toBe('fresh')
    expect(next.at(-1)?.id).toBe(`old-${ACTIVITY_LOG_CAP - 2}`)
  })

  it('preserves siteKey on file entries (never full tab URLs)', () => {
    const next = appendActivityEntry([], {
      actor: 'sweep',
      action: 'tab.file',
      groupTitle: 'GitHub',
      tabId: 9,
      siteKey: 'github.com',
      tabCount: 1,
    }, { id: 'file-1', now: 1 })
    expect(next[0]).toMatchObject({
      id: 'file-1',
      siteKey: 'github.com',
      tabCount: 1,
    })
    expect(next[0]).not.toHaveProperty('tabUrl')
  })
})

describe('parseStoredActivityLog privacy', () => {
  it('drops legacy tabUrl fields from stored rows', () => {
    const parsed = parseStoredActivityLog([
      {
        id: 'legacy',
        ts: 1,
        actor: 'sweep',
        action: 'tab.file',
        siteKey: 'github.com',
        tabUrl: 'https://github.com/acme/secret-path',
        tabCount: 1,
      },
    ])
    expect(parsed).toHaveLength(1)
    expect(parsed[0]?.siteKey).toBe('github.com')
    expect(parsed[0]).not.toHaveProperty('tabUrl')
  })
})

describe('parseStoredActivityLog', () => {
  it('drops malformed rows and keeps valid ones', () => {
    const parsed = parseStoredActivityLog([
      null,
      { id: 'bad' },
      {
        id: 'ok',
        ts: 42,
        actor: 'ai',
        action: 'group.rename',
        oldTitle: 'Cloud',
        newTitle: 'Bug Reports',
        model: 'deepseek-r1:14b',
      },
    ])
    expect(parsed).toEqual([
      {
        id: 'ok',
        ts: 42,
        actor: 'ai',
        action: 'group.rename',
        oldTitle: 'Cloud',
        newTitle: 'Bug Reports',
        model: 'deepseek-r1:14b',
      },
    ])
  })
})

describe('filterActivityByActor', () => {
  it('filters or returns all', () => {
    const rows = [
      entry({ id: 'a', actor: 'ai', action: 'group.rename' }),
      entry({ id: 'b', actor: 'user', action: 'group.rename' }),
    ]
    expect(filterActivityByActor(rows, 'ai').map((row) => row.id)).toEqual(['a'])
    expect(filterActivityByActor(rows, 'all')).toHaveLength(2)
  })
})

describe('filterActivityByFilter', () => {
  it('groups organize actors and rules', () => {
    const rows = [
      entry({ id: 'a', actor: 'ai', action: 'group.rename' }),
      entry({ id: 'b', actor: 'user', action: 'group.rename' }),
      entry({ id: 'c', actor: 'sweep', action: 'tab.file' }),
      entry({ id: 'd', actor: 'organizer', action: 'tab.file' }),
      entry({ id: 'e', actor: 'rule', action: 'group.create' }),
    ]
    expect(filterActivityByFilter(rows, 'organize').map((row) => row.id)).toEqual(['c', 'd'])
    expect(filterActivityByFilter(rows, 'rules').map((row) => row.id)).toEqual(['e'])
    expect(filterActivityByFilter(rows, 'you').map((row) => row.id)).toEqual(['b'])
    expect(filterActivityByFilter(rows, 'all')).toHaveLength(5)
  })
})

describe('formatActivityTime', () => {
  it('uses relative and dated labels', () => {
    const now = Date.parse('2026-11-25T20:41:00')
    expect(formatActivityTime(entry({ action: 'group.rename', actor: 'ai', ts: now - 10_000 }), now)).toBe(
      'Just now',
    )
    expect(formatActivityTime(entry({ action: 'group.rename', actor: 'ai', ts: now - 3 * 60_000 }), now)).toBe(
      '3 min ago',
    )
    expect(
      formatActivityTime(entry({ action: 'group.rename', actor: 'ai', ts: now - 26 * 60 * 60_000 }), now),
    ).toMatch(/^Yesterday /)
  })
})

describe('formatActivityLine', () => {
  it('formats an AI rename to Bug Reports with the model', () => {
    const now = Date.parse('2026-11-25T20:41:00')
    const line = formatActivityLine(
      entry({
        actor: 'ai',
        action: 'group.rename',
        oldTitle: 'Cloud',
        newTitle: 'Bug Reports',
        model: 'deepseek-r1:14b',
        ts: now,
      }),
      now,
    )
    expect(line).toContain('AI renamed "Cloud" → "Bug Reports" · deepseek-r1:14b')
    expect(line).toMatch(/Just now · AI renamed/)
  })

  it('formats tab.close in plain English', () => {
    expect(
      formatActivityLine(
        entry({
          actor: 'system',
          action: 'tab.close',
          tabCount: 3,
          reason: 'unused for 30 days',
        }),
      ),
    ).toContain('Tab Organizer closed 3 old tabs (unused for 30 days)')

    expect(
      formatActivityLine(
        entry({
          actor: 'user',
          action: 'tab.close',
          tabCount: 1,
          reason: 'unused for 7 days',
        }),
      ),
    ).toContain('You closed 1 old tab (unused for 7 days)')
  })

  it('formats tab.reopen in plain English', () => {
    expect(
      formatActivityLine(
        entry({
          actor: 'user',
          action: 'tab.reopen',
          tabCount: 2,
        }),
      ),
    ).toContain('You reopened 2 tabs from the last clean-up')
  })

  it('formats organize file, user rename, and AI skip lines in plain English', () => {
    expect(
      formatActivityLine(
        entry({
          actor: 'sweep',
          action: 'tab.file',
          groupTitle: 'Local',
          tabCount: 1,
        }),
      ),
    ).toContain('Organize put a tab in "Local"')

    expect(
      formatActivityLine(
        entry({
          actor: 'user',
          action: 'group.rename',
          oldTitle: 'Github',
          newTitle: 'GitHub',
        }),
      ),
    ).toContain('You renamed "Github" → "GitHub"')

    expect(
      formatActivityLine(
        entry({
          actor: 'ai',
          action: 'rename.skip',
          oldTitle: 'Cloud',
          reason: 'Low confidence',
          model: 'deepseek-r1:14b',
        }),
      ),
    ).toContain('AI left "Cloud" as-is (Low confidence) · deepseek-r1:14b')
  })
})
