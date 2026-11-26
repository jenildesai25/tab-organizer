import { describe, expect, it } from 'vitest'
import {
  ACTIVITY_LOG_CAP,
  appendActivityEntry,
  createActivityEntry,
  filterActivityByActor,
  formatActivityLine,
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
    expect(next).toHaveLength(ACTIVITY_LOG_CAP)
    expect(next[0]?.id).toBe('fresh')
    expect(next.at(-1)?.id).toBe(`old-${ACTIVITY_LOG_CAP - 2}`)
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

describe('formatActivityLine', () => {
  it('formats an AI rename to Bug Reports with the model', () => {
    const line = formatActivityLine(
      entry({
        actor: 'ai',
        action: 'group.rename',
        oldTitle: 'Cloud',
        newTitle: 'Bug Reports',
        model: 'deepseek-r1:14b',
        ts: Date.parse('2026-11-25T20:41:00'),
      }),
    )
    expect(line).toContain('AI renamed "Cloud" → "Bug Reports" (deepseek-r1:14b)')
    expect(line).toMatch(/· AI renamed/)
  })

  it('formats sweep file, user rename, and AI skip lines', () => {
    expect(
      formatActivityLine(
        entry({
          actor: 'sweep',
          action: 'tab.file',
          groupTitle: 'Local',
          tabCount: 1,
        }),
      ),
    ).toContain('Sweep filed tab into "Local"')

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
    ).toContain('AI skipped "Cloud" (Low confidence) (deepseek-r1:14b)')
  })
})
