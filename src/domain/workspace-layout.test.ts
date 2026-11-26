import { describe, expect, it } from 'vitest'
import {
  assignTabsToLayout,
  buildWorkspaceLayout,
  clampLayoutName,
  deleteWorkspaceLayout,
  parseWorkspaceLayouts,
  upsertWorkspaceLayout,
} from './workspace-layout.js'

describe('workspace layouts', () => {
  it('builds a layout from titled groups and member pages', () => {
    const layout = buildWorkspaceLayout(
      '  Work desk  ',
      [
        { id: 1, title: 'GitHub', color: 'blue' },
        { id: 2, title: '', color: 'red' },
        { id: 3, title: 'Shared', color: 'grey', shared: true },
      ],
      [
        { id: 10, groupId: 1, url: 'https://github.com/acme/repo?x=1' },
        { id: 11, groupId: 1, url: 'https://github.com/acme/other' },
        { id: 12, groupId: 3, url: 'https://docs.google.com/' },
      ],
      { id: 'layout-1', savedAt: 50 },
    )
    expect(layout).toEqual({
      id: 'layout-1',
      name: 'Work desk',
      savedAt: 50,
      groups: [
        {
          title: 'GitHub',
          color: 'blue',
          patterns: ['https://github.com/acme/other', 'https://github.com/acme/repo'],
          domains: ['github.com'],
        },
      ],
    })
  })

  it('returns null when the name is empty or no groups qualify', () => {
    expect(buildWorkspaceLayout('   ', [{ id: 1, title: 'A' }], [{ id: 1, groupId: 1, url: 'https://a.com' }])).toBeNull()
    expect(buildWorkspaceLayout('Desk', [{ id: 1, title: '' }], [])).toBeNull()
  })

  it('parses, upserts, and deletes layouts', () => {
    const parsed = parseWorkspaceLayouts([
      {
        id: 'a',
        name: 'A',
        savedAt: 1,
        groups: [{ title: 'GitHub', color: 'blue', patterns: ['https://github.com/x'], domains: ['github.com'] }],
      },
      { id: 'bad', name: '', groups: [] },
    ])
    expect(parsed).toHaveLength(1)
    const next = upsertWorkspaceLayout(parsed, {
      id: 'b',
      name: 'B',
      savedAt: 2,
      groups: [{ title: 'Mail', color: 'red', patterns: [], domains: ['gmail.com'] }],
    })
    expect(next.map((row) => row.id)).toEqual(['b', 'a'])
    expect(deleteWorkspaceLayout(next, 'a').map((row) => row.id)).toEqual(['b'])
  })

  it('assigns open tabs by pattern, then by unique domain', () => {
    const layout = {
      id: 'x',
      name: 'X',
      savedAt: 1,
      groups: [
        {
          title: 'GitHub',
          color: 'blue' as const,
          patterns: ['https://github.com/acme/repo'],
          domains: ['github.com'],
        },
        {
          title: 'Docs',
          color: 'red' as const,
          patterns: [],
          domains: ['example.com'],
        },
      ],
    }
    const assigned = assignTabsToLayout(layout, [
      { id: 1, url: 'https://github.com/acme/repo/pulls' },
      { id: 2, url: 'https://github.com/other/x' },
      { id: 3, url: 'https://example.com/help' },
      { id: 4, url: 'chrome://extensions' },
    ])
    expect(assigned).toEqual([
      { title: 'GitHub', color: 'blue', tabIds: [1, 2] },
      { title: 'Docs', color: 'red', tabIds: [3] },
    ])
  })

  it('does not domain-match when two groups claim the same site', () => {
    const layout = {
      id: 'x',
      name: 'X',
      savedAt: 1,
      groups: [
        { title: 'PRs', color: 'blue' as const, patterns: ['https://github.com/acme/a'], domains: ['github.com'] },
        { title: 'Docs', color: 'green' as const, patterns: ['https://github.com/acme/b'], domains: ['github.com'] },
      ],
    }
    expect(
      assignTabsToLayout(layout, [{ id: 9, url: 'https://github.com/other' }]),
    ).toEqual([])
    expect(
      assignTabsToLayout(layout, [{ id: 9, url: 'https://github.com/acme/a/issues' }]),
    ).toEqual([{ title: 'PRs', color: 'blue', tabIds: [9] }])
  })

  it('clamps layout names', () => {
    expect(clampLayoutName('  Hello   world  ')).toBe('Hello world')
    expect(clampLayoutName('x'.repeat(80)).length).toBe(40)
  })
})
