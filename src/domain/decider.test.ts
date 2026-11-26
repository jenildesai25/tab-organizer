import { describe, expect, it } from 'vitest'
import { fixtures } from '../../evals/fixtures/cases.js'
import { decide } from './decider.js'
import { marksSticky } from './stickiness.js'
import { describeSweep, sweepClaimsNothing } from './summary.js'
import type { Action, DecideInput, FeatureCard, GroupState, TabState } from './types.js'
import { words } from './words.js'

describe('decider fixtures', () => {
  for (const fixture of fixtures) {
    it(fixture.name, () => {
      const actions = decide(fixture.input)
      expect(actions.map((action) => action.type)).toEqual(fixture.expect.types)
      const file = actions.find((action) => action.type === 'file')
      if (fixture.expect.expand !== undefined) {
        expect(file && file.type === 'file' ? file.expand : undefined).toBe(fixture.expect.expand)
      }
      if (fixture.expect.createTitle !== undefined) {
        expect(file && file.type === 'file' ? file.create?.title : undefined).toBe(fixture.expect.createTitle)
      }
      if (fixture.expect.aroundTabId !== undefined) {
        expect(file && file.type === 'file' ? file.create?.aroundTabId : undefined).toBe(fixture.expect.aroundTabId)
      }
      if (fixture.expect.tabIds !== undefined) {
        expect(file && file.type === 'file' ? file.tabIds : undefined).toEqual(fixture.expect.tabIds)
      }
      if (fixture.expect.groupId !== undefined) {
        expect(file && file.type === 'file' ? file.groupId : undefined).toBe(fixture.expect.groupId)
      }
      if (fixture.expect.retitle) {
        const retitle = actions.find((action) => action.type === 'retitle')
        expect(retitle).toMatchObject({ type: 'retitle', ...fixture.expect.retitle })
      }
      if (fixture.expect.readyAt !== undefined) {
        const wait = actions.find((action) => action.type === 'wait')
        expect(wait && wait.type === 'wait' ? wait.readyAt : undefined).toBe(fixture.expect.readyAt)
      }
      if (fixture.expect.files) {
        const files = actions.filter((action) => action.type === 'file')
        expect(files).toHaveLength(fixture.expect.files.length)
        fixture.expect.files.forEach((expected, index) => {
          const actual = files[index]
          if (!actual || actual.type !== 'file') return
          if (expected.createTitle !== undefined) expect(actual.create?.title).toBe(expected.createTitle)
          if (expected.expand !== undefined) expect(actual.expand).toBe(expected.expand)
          if (expected.tabIds !== undefined) expect(actual.tabIds).toEqual(expected.tabIds)
        })
      }
      assertAdvisorPayload(actions)
    })
  }
})

describe('sweep summary', () => {
  it('counts duplicate sites, lone sites, and skipped pages', () => {
    const fixture = fixtures.find((item) => item.name === 'a sweep groups duplicate sites and gives each lone site a group')
    expect(fixture).toBeDefined()
    if (!fixture) return
    const actions = decide(fixture.input)
    expect(describeSweep(fixture.input.tabs, actions)).toBe(
      'Looked at 10. Already grouped 0. Eligible 8. Grouped 8 into 4 groups. Skipped 2 browser/pinned. Hidden 0.',
    )
    expect(describeSweep(fixture.input.tabs, actions)).not.toContain('No loose tabs')
    expect(sweepClaimsNothing(fixture.input.tabs, actions, fixture.input.groups)).toBe(false)
  })

  it('does not call a window of ordinary pages empty', () => {
    const fixture = fixtures.find((item) => item.name === 'a sweep files ungrouped tabs that were marked sticky')
    expect(fixture).toBeDefined()
    if (!fixture) return
    const actions = decide(fixture.input)
    expect(actions.some((action) => action.type === 'file')).toBe(true)
    expect(describeSweep(fixture.input.tabs, actions)).toBe(
      'Looked at 2. Already grouped 0. Eligible 2. Grouped 2 into 1 groups. Skipped 0 browser/pinned. Hidden 0.',
    )
    expect(sweepClaimsNothing(fixture.input.tabs, [], fixture.input.groups)).toBe(true)
    expect(describeSweep(fixture.input.tabs, [])).not.toContain('No loose tabs')
  })

  it('names pinned tabs and browser pages that were skipped', () => {
    const fixture = fixtures.find((item) => item.name === 'a sweep skips pinned tabs and browser pages')
    expect(fixture).toBeDefined()
    if (!fixture) return
    const actions = decide(fixture.input)
    expect(describeSweep(fixture.input.tabs, actions)).toBe(
      'Looked at 2. Already grouped 0. Eligible 0. Grouped 0 into 0 groups. Skipped 2 browser/pinned. Hidden 0.',
    )
    expect(sweepClaimsNothing(fixture.input.tabs, actions, fixture.input.groups)).toBe(false)
  })

  it('files http tabs beside empty-url pinned and browser pages', () => {
    const fixture = fixtures.find(
      (item) => item.name === 'a sweep files http tabs beside empty-url pinned and browser pages',
    )
    expect(fixture).toBeDefined()
    if (!fixture) return
    const actions = decide(fixture.input)
    expect(actions.some((action) => action.type === 'file')).toBe(true)
    expect(describeSweep(fixture.input.tabs, actions)).toBe(
      'Looked at 6. Already grouped 0. Eligible 3. Grouped 3 into 2 groups. Skipped 2 browser/pinned. Hidden 1.',
    )
    expect(sweepClaimsNothing(fixture.input.tabs, actions, fixture.input.groups)).toBe(false)
  })

  it('does not count empty-url tabs as skipped browser pages', () => {
    const fixture = fixtures.find(
      (item) => item.name === 'a sweep files http tabs beside empty-url pinned and browser pages',
    )
    expect(fixture).toBeDefined()
    if (!fixture) return
    const empty = fixture.input.tabs.find((tab) => !tab.http && !tab.browserPage && !tab.pinned)
    expect(empty).toBeDefined()
    const skipped = fixture.input.tabs.filter((tab) => tab.pinned || tab.browserPage)
    expect(skipped).toHaveLength(2)
  })
})

describe('advisor suggestions', () => {
  it('does not file a tab into an unrelated group the model names', () => {
    const actions = decide(
      suggestionInput({
        title: 'Bank',
        group: { title: 'Bank', dominantDomain: 'bank.com', domains: ['bank.com'], words: ['bank'] },
      }),
    )
    expect(actions.filter((action) => action.type === 'file')).toEqual([])
  })

  it('may file into a group that already holds the tab site', () => {
    const actions = decide(
      suggestionInput({
        title: 'GitHub',
        group: { title: 'GitHub', dominantDomain: 'github.com', domains: ['github.com'], words: ['github'] },
      }),
    )
    const file = actions.find((action) => action.type === 'file')
    expect(file && file.type === 'file' ? file.groupId : undefined).toBe(7)
  })
})

describe('stickiness', () => {
  it('marks a tab sticky only after a drag this extension did not cause', () => {
    expect(marksSticky('moved', false)).toBe(true)
    expect(marksSticky('moved', true)).toBe(false)
    expect(marksSticky('updated', false)).toBe(false)
    expect(marksSticky('updated', true)).toBe(false)
  })
})

function suggestionInput(options: {
  title: string
  group: Pick<GroupState, 'title' | 'dominantDomain' | 'domains' | 'words'>
}): DecideInput {
  const card: FeatureCard = {
    domain: 'github.com',
    title: 'Pull request',
    titleWords: words('Pull request'),
    pathWords: [],
    openerDomain: null,
  }
  const tab: TabState = {
    id: 1,
    active: false,
    pinned: false,
    incognito: false,
    http: true,
    browserPage: false,
    sticky: false,
    openedInsideGroup: false,
    candidate: true,
    status: 'complete',
    titleStableSince: 0,
    groupId: null,
    lastFiledDomain: null,
    advisorPending: true,
    card,
  }
  const group: GroupState = {
    id: 7,
    size: 2,
    collapsed: false,
    shared: false,
    handRenamed: true,
    ...options.group,
  }
  return {
    now: 10_000,
    organizerOn: true,
    llmOn: true,
    mode: 'watch',
    focused: true,
    rules: [],
    groups: [group],
    tabs: [tab],
    suggestion: { tabId: 1, title: options.title, confidence: 0.95 },
  }
}

function assertAdvisorPayload(actions: Action[]) {
  for (const action of actions) {
    if (action.type !== 'ask-advisor') continue
    const blob = JSON.stringify(action)
    expect(blob).not.toMatch(/https?:\/\//)
    expect(blob).not.toContain('access_token')
    expect(blob).not.toContain('utm_')
    expect(action.card).not.toHaveProperty('url')
  }
}
