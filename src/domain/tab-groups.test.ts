import { describe, expect, it } from 'vitest'
import {
  countTabsInGroup,
  isChromeColor,
  normalizeGroupColor,
  tabGroupViewFromChrome,
  tabGroupViewsFromChrome,
  TAB_GROUP_COLORS,
} from './tab-groups.js'

describe('tab group view mapping', () => {
  it('exposes every Chrome tab group color', () => {
    expect(TAB_GROUP_COLORS).toEqual([
      'grey',
      'blue',
      'red',
      'yellow',
      'green',
      'pink',
      'purple',
      'cyan',
      'orange',
    ])
  })

  it('normalizes unknown colors to grey', () => {
    expect(normalizeGroupColor('blue')).toBe('blue')
    expect(normalizeGroupColor(undefined)).toBe('grey')
    expect(normalizeGroupColor('neon')).toBe('grey')
    expect(isChromeColor('cyan')).toBe(true)
    expect(isChromeColor('teal')).toBe(false)
  })

  it('counts tabs belonging to a group', () => {
    const tabs = [{ groupId: 3 }, { groupId: 3 }, { groupId: -1 }, { groupId: 7 }, { groupId: null }]
    expect(countTabsInGroup(3, tabs)).toBe(2)
    expect(countTabsInGroup(7, tabs)).toBe(1)
    expect(countTabsInGroup(9, tabs)).toBe(0)
  })

  it('maps chrome groups into editable view models', () => {
    const view = tabGroupViewFromChrome(
      { id: 12, title: 'GitHub', color: 'green', collapsed: true, shared: false },
      [{ groupId: 12 }, { groupId: 12 }, { groupId: 4 }],
    )
    expect(view).toEqual({
      id: 12,
      title: 'GitHub',
      color: 'green',
      collapsed: true,
      shared: false,
      tabCount: 2,
      editable: true,
    })
  })

  it('marks shared groups read-only and fills missing fields', () => {
    const view = tabGroupViewFromChrome({ id: 1, shared: true }, [{ groupId: 1 }])
    expect(view.title).toBe('')
    expect(view.color).toBe('grey')
    expect(view.collapsed).toBe(false)
    expect(view.shared).toBe(true)
    expect(view.editable).toBe(false)
    expect(view.tabCount).toBe(1)
  })

  it('sorts mapped groups by id', () => {
    const views = tabGroupViewsFromChrome(
      [
        { id: 9, title: 'B', color: 'red' },
        { id: 2, title: 'A', color: 'blue' },
      ],
      [{ groupId: 9 }, { groupId: 2 }, { groupId: 2 }],
    )
    expect(views.map((group) => group.id)).toEqual([2, 9])
    expect(views[0]?.tabCount).toBe(2)
    expect(views[1]?.tabCount).toBe(1)
  })
})
