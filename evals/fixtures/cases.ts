import type { DecideInput, FeatureCard, GroupState, TabState } from '../../src/domain/types.js'
import { words } from '../../src/domain/words.js'

export type FixtureExpect = {
  types: string[]
  expand?: boolean
  createTitle?: string
  aroundTabId?: number
  tabIds?: number[]
  groupId?: number | null
  retitle?: { groupId: number; title: string }
  readyAt?: number | null
  files?: { createTitle?: string; expand?: boolean; tabIds?: number[] }[]
}

export type Fixture = {
  name: string
  uncertain?: boolean
  expectedTitle?: string
  input: DecideInput
  expect: FixtureExpect
}

function card(domain: string, title: string, pathWords: string[] = []): FeatureCard {
  return { domain, title, titleWords: words(title), pathWords, openerDomain: null }
}

function tab(id: number, domain: string, title: string, extra: Partial<TabState> = {}): TabState {
  return {
    id,
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
    advisorPending: false,
    card: card(domain, title),
    ...extra,
  }
}

function group(id: number, title: string, extra: Partial<GroupState> = {}): GroupState {
  return {
    id,
    title,
    dominantDomain: null,
    domains: [],
    words: [],
    size: 1,
    collapsed: false,
    shared: false,
    handRenamed: false,
    ...extra,
  }
}

function decideInput(extra: Partial<DecideInput>): DecideInput {
  return {
    now: 10_000,
    organizerOn: true,
    llmOn: false,
    mode: 'watch',
    focused: true,
    rules: [],
    groups: [],
    tabs: [],
    suggestion: null,
    ...extra,
  }
}

const githubRule = {
  id: 'gb',
  sentence: 'use gb for github',
  domains: ['github.com'],
  title: 'gb',
}

export const fixtures: Fixture[] = [
  {
    name: 'gb github rule',
    input: decideInput({
      rules: [githubRule],
      tabs: [tab(1, 'github.com', 'Pull request', { active: true })],
    }),
    expect: {
      types: ['file'],
      expand: true,
      createTitle: 'gb',
      aroundTabId: 1,
      tabIds: [1],
      groupId: null,
    },
  },
  {
    name: 'rule retitles an existing site group',
    input: decideInput({
      rules: [githubRule],
      groups: [group(10, 'GitHub', { dominantDomain: 'github.com', domains: ['github.com'], size: 3 })],
      tabs: [tab(1, 'github.com', 'Pull request', { active: true })],
    }),
    expect: {
      types: ['retitle', 'file'],
      retitle: { groupId: 10, title: 'gb' },
      expand: true,
      groupId: 10,
      tabIds: [1],
    },
  },
  {
    name: 'creating a group around the active tab',
    input: decideInput({
      tabs: [
        tab(1, 'github.com', 'Pull request', { active: true }),
        tab(2, 'github.com', 'Issue list'),
      ],
    }),
    expect: {
      types: ['file'],
      expand: true,
      createTitle: 'GitHub',
      aroundTabId: 1,
      tabIds: [1, 2],
      groupId: null,
    },
  },
  {
    name: 'cross-site pair with no shared words each gets a site group',
    input: decideInput({
      tabs: [
        tab(1, 'wirecutter.com', 'Pasta recipe', { active: true }),
        tab(2, 'amazon.com', 'USB cable'),
      ],
    }),
    expect: {
      types: ['file', 'file'],
      files: [
        { createTitle: 'Wirecutter', expand: true, tabIds: [1] },
        { createTitle: 'Amazon', expand: false, tabIds: [2] },
      ],
    },
  },
  {
    name: 'shared title words file at the high overlap',
    input: decideInput({
      groups: [
        group(4, 'standing desk', {
          dominantDomain: 'wirecutter.com',
          domains: ['wirecutter.com'],
          words: ['standing', 'desk', 'wirecutter'],
          size: 2,
          collapsed: true,
        }),
      ],
      tabs: [tab(1, 'amazon.com', 'Standing desk review', { active: true })],
    }),
    expect: { types: ['file'], expand: true, groupId: 4, tabIds: [1] },
  },
  {
    name: 'llm off never requests an advisor',
    input: decideInput({
      llmOn: false,
      groups: [
        group(4, 'standing desk', {
          dominantDomain: 'wirecutter.com',
          domains: ['wirecutter.com'],
          words: ['standing', 'desk', 'mat'],
          size: 2,
        }),
      ],
      tabs: [tab(1, 'amazon.com', 'Standing lamp', { active: true })],
    }),
    expect: {
      types: ['file'],
      createTitle: 'Amazon',
      expand: true,
      aroundTabId: 1,
      tabIds: [1],
      groupId: null,
    },
  },
  {
    name: 'uncertain standing desk asks the advisor',
    uncertain: true,
    expectedTitle: 'standing desk',
    input: decideInput({
      llmOn: true,
      groups: [
        group(4, 'standing desk', {
          dominantDomain: 'wirecutter.com',
          domains: ['wirecutter.com'],
          words: ['standing', 'desk', 'mat'],
          size: 2,
        }),
      ],
      tabs: [tab(1, 'amazon.com', 'Uplift standing desk review', { active: true })],
    }),
    expect: { types: ['ask-advisor'] },
  },
  {
    name: 'half a second is still waiting',
    input: decideInput({
      now: 2000,
      tabs: [tab(1, 'github.com', 'Pull request', { active: true, titleStableSince: 1500 })],
    }),
    expect: { types: ['wait'], readyAt: 3500 },
  },
  {
    name: 'two seconds files and expands the active tab',
    input: decideInput({
      now: 2000,
      tabs: [
        tab(1, 'github.com', 'Pull request', { active: true, titleStableSince: 0 }),
        tab(2, 'github.com', 'Issue list', { titleStableSince: 0 }),
      ],
    }),
    expect: {
      types: ['file'],
      expand: true,
      createTitle: 'GitHub',
      aroundTabId: 1,
      tabIds: [1, 2],
    },
  },
  {
    name: 'a background file does not expand',
    input: decideInput({
      groups: [
        group(10, 'GitHub', {
          dominantDomain: 'github.com',
          domains: ['github.com'],
          collapsed: true,
          size: 4,
        }),
      ],
      tabs: [tab(2, 'github.com', 'Issue list')],
    }),
    expect: { types: ['file'], expand: false, groupId: 10, tabIds: [2] },
  },
  {
    name: 'a sweep of one site expands the group with the active tab',
    input: decideInput({
      organizerOn: false,
      focused: false,
      mode: 'sweep',
      tabs: [
        tab(1, 'github.com', 'Pull request', { active: true, candidate: false }),
        tab(2, 'github.com', 'Issue list', { candidate: false }),
      ],
    }),
    expect: {
      types: ['file'],
      expand: true,
      createTitle: 'GitHub',
      aroundTabId: 1,
      tabIds: [1, 2],
    },
  },
  {
    name: 'a sticky tab stays put',
    input: decideInput({
      groups: [group(10, 'GitHub', { dominantDomain: 'github.com', domains: ['github.com'] })],
      tabs: [tab(2, 'github.com', 'Issue list', { sticky: true, active: true })],
    }),
    expect: { types: [] },
  },
  {
    name: 'a shared group is untouched',
    input: decideInput({
      groups: [
        group(10, 'GitHub', {
          dominantDomain: 'github.com',
          domains: ['github.com'],
          shared: true,
          size: 3,
        }),
      ],
      tabs: [
        tab(1, 'github.com', 'Pull request', { active: true }),
        tab(2, 'github.com', 'Issue list'),
      ],
    }),
    expect: { types: [] },
  },
  {
    name: 'pinned tabs are skipped',
    input: decideInput({
      groups: [group(10, 'GitHub', { dominantDomain: 'github.com', domains: ['github.com'] })],
      tabs: [tab(2, 'github.com', 'Issue list', { pinned: true, active: true })],
    }),
    expect: { types: [] },
  },
  {
    name: 'internal pages are skipped',
    input: decideInput({
      tabs: [
        tab(1, '', 'Settings', {
          active: true,
          http: false,
          browserPage: true,
          card: card('', 'Settings'),
        }),
      ],
    }),
    expect: { types: [] },
  },
  {
    name: 'a hand-renamed group keeps its title',
    input: decideInput({
      groups: [
        group(3, 'code', {
          dominantDomain: 'github.com',
          domains: ['github.com'],
          handRenamed: true,
          size: 2,
        }),
      ],
      tabs: [tab(1, 'github.com', 'Pull request', { active: true })],
    }),
    expect: { types: ['file'], expand: true, groupId: 3, tabIds: [1] },
  },
  {
    name: 'watch ignores tabs that were already open',
    input: decideInput({
      tabs: [
        tab(1, 'github.com', 'Pull request', { active: true, candidate: false }),
        tab(2, 'github.com', 'Issue list', { candidate: false }),
      ],
    }),
    expect: { types: [] },
  },
  {
    name: 'a link opened inside a group stays there',
    input: decideInput({
      groups: [group(10, 'GitHub', { dominantDomain: 'github.com', domains: ['github.com'] })],
      tabs: [tab(2, 'github.com', 'Issue list', { groupId: 10, openedInsideGroup: true, active: true })],
    }),
    expect: { types: [] },
  },
  {
    name: 'google then whatsapp moves into an existing WhatsApp group',
    input: decideInput({
      groups: [
        group(10, 'Google', {
          dominantDomain: 'google.com',
          domains: ['google.com'],
          size: 2,
        }),
        group(20, 'Whatsapp', {
          dominantDomain: 'whatsapp.com',
          domains: ['whatsapp.com'],
          size: 1,
        }),
      ],
      tabs: [
        tab(1, 'whatsapp.com', 'WhatsApp', {
          active: true,
          groupId: 10,
          lastFiledDomain: 'google.com',
        }),
      ],
    }),
    expect: { types: ['file'], expand: true, groupId: 20, tabIds: [1] },
  },
  {
    name: 'google then whatsapp creates a WhatsApp group',
    input: decideInput({
      groups: [
        group(10, 'Google', {
          dominantDomain: 'google.com',
          domains: ['google.com'],
          size: 2,
        }),
      ],
      tabs: [
        tab(1, 'whatsapp.com', 'WhatsApp', {
          active: true,
          groupId: 10,
          lastFiledDomain: 'google.com',
        }),
      ],
    }),
    expect: {
      types: ['file'],
      expand: true,
      createTitle: 'Whatsapp',
      aroundTabId: 1,
      tabIds: [1],
      groupId: null,
    },
  },
  {
    name: 'opened-inside-group still refiles after the site changes',
    input: decideInput({
      groups: [
        group(10, 'Google', {
          dominantDomain: 'google.com',
          domains: ['google.com'],
          size: 2,
        }),
        group(20, 'Whatsapp', {
          dominantDomain: 'whatsapp.com',
          domains: ['whatsapp.com'],
          size: 1,
        }),
      ],
      tabs: [
        tab(1, 'whatsapp.com', 'WhatsApp', {
          active: true,
          groupId: 10,
          openedInsideGroup: true,
          lastFiledDomain: 'google.com',
        }),
      ],
    }),
    expect: { types: ['file'], expand: true, groupId: 20, tabIds: [1] },
  },
  {
    name: 'already filed for the current site stays put',
    input: decideInput({
      groups: [
        group(20, 'Whatsapp', {
          dominantDomain: 'whatsapp.com',
          domains: ['whatsapp.com'],
          size: 1,
        }),
      ],
      tabs: [
        tab(1, 'whatsapp.com', 'WhatsApp', {
          active: true,
          groupId: 20,
          lastFiledDomain: 'whatsapp.com',
        }),
      ],
    }),
    expect: { types: [] },
  },
  {
    // Solo redirect: live dominantDomain flips to Brooks while the title still
    // says Capitaloneshopping — must move into the existing Brooks group, not
    // rename Capitaloneshopping or treat it as the Brooks bucket.
    name: 'capitalone then brooks moves into an existing Brooks group',
    input: decideInput({
      groups: [
        group(10, 'Capitaloneshopping', {
          dominantDomain: 'brooksrunning.com',
          domains: ['brooksrunning.com'],
          size: 1,
        }),
        group(20, 'Brooksrunning', {
          dominantDomain: 'brooksrunning.com',
          domains: ['brooksrunning.com'],
          size: 1,
        }),
      ],
      tabs: [
        tab(1, 'brooksrunning.com', 'Brooks Running', {
          active: true,
          groupId: 10,
          lastFiledDomain: 'capitaloneshopping.com',
        }),
      ],
    }),
    expect: { types: ['file'], expand: true, groupId: 20, tabIds: [1] },
  },
  {
    name: 'capitalone then brooks creates a Brooks group',
    input: decideInput({
      groups: [
        group(10, 'Capitaloneshopping', {
          dominantDomain: 'brooksrunning.com',
          domains: ['brooksrunning.com'],
          size: 1,
        }),
      ],
      tabs: [
        tab(1, 'brooksrunning.com', 'Brooks Running', {
          active: true,
          groupId: 10,
          lastFiledDomain: 'capitaloneshopping.com',
        }),
      ],
    }),
    expect: {
      types: ['file'],
      expand: true,
      createTitle: 'Brooksrunning',
      aroundTabId: 1,
      tabIds: [1],
      groupId: null,
    },
  },
  {
    name: 'solo google then whatsapp creates WhatsApp when dominant flipped',
    input: decideInput({
      groups: [
        group(10, 'Google', {
          dominantDomain: 'whatsapp.com',
          domains: ['whatsapp.com'],
          size: 1,
        }),
      ],
      tabs: [
        tab(1, 'whatsapp.com', 'WhatsApp', {
          active: true,
          groupId: 10,
          lastFiledDomain: 'google.com',
        }),
      ],
    }),
    expect: {
      types: ['file'],
      expand: true,
      createTitle: 'Whatsapp',
      aroundTabId: 1,
      tabIds: [1],
      groupId: null,
    },
  },
  {
    // New Brooks tab must not join a Capitaloneshopping-titled group whose
    // dominantDomain flipped after a solo redirect.
    name: 'new brooks tab does not join a flipped Capitaloneshopping group',
    input: decideInput({
      groups: [
        group(10, 'Capitaloneshopping', {
          dominantDomain: 'brooksrunning.com',
          domains: ['brooksrunning.com'],
          size: 1,
        }),
        group(20, 'Brooksrunning', {
          dominantDomain: 'brooksrunning.com',
          domains: ['brooksrunning.com'],
          size: 1,
        }),
      ],
      tabs: [
        tab(2, 'brooksrunning.com', 'Brooks Running', {
          active: true,
          groupId: null,
          lastFiledDomain: null,
        }),
      ],
    }),
    expect: { types: ['file'], expand: true, groupId: 20, tabIds: [2] },
  },
  {
    name: 'new brooks tab opened inside Capitaloneshopping leaves for Brooks',
    input: decideInput({
      groups: [
        group(10, 'Capitaloneshopping', {
          dominantDomain: 'capitaloneshopping.com',
          domains: ['capitaloneshopping.com'],
          size: 2,
        }),
        group(20, 'Brooksrunning', {
          dominantDomain: 'brooksrunning.com',
          domains: ['brooksrunning.com'],
          size: 1,
        }),
      ],
      tabs: [
        tab(2, 'brooksrunning.com', 'Brooks Running', {
          active: true,
          groupId: 10,
          openedInsideGroup: true,
          lastFiledDomain: null,
        }),
      ],
    }),
    expect: { types: ['file'], expand: true, groupId: 20, tabIds: [2] },
  },
  {
    name: 'an unfocused window is not watched',
    input: decideInput({
      focused: false,
      tabs: [
        tab(1, 'github.com', 'Pull request', { active: true }),
        tab(2, 'github.com', 'Issue list'),
      ],
    }),
    expect: { types: [] },
  },
  {
    name: 'a confident advisor title creates a topic group',
    input: decideInput({
      llmOn: true,
      suggestion: { tabId: 1, title: 'standing desk', confidence: 0.9 },
      tabs: [tab(1, 'amazon.com', 'Lamp', { active: true })],
    }),
    expect: {
      types: ['file'],
      expand: true,
      createTitle: 'standing desk',
      aroundTabId: 1,
      tabIds: [1],
    },
  },
  {
    name: 'a low confidence advisor reply files nothing',
    input: decideInput({
      llmOn: true,
      suggestion: { tabId: 1, title: 'standing desk', confidence: 0.4 },
      tabs: [tab(1, 'amazon.com', 'Lamp', { active: true })],
    }),
    expect: { types: [] },
  },
  {
    name: 'github.io is not the github rule',
    input: decideInput({
      rules: [githubRule],
      tabs: [
        tab(1, 'github.io', 'Project notes', { active: true }),
        tab(2, 'github.io', 'Docs'),
      ],
    }),
    expect: {
      types: ['file'],
      createTitle: 'GitHub Pages',
      aroundTabId: 1,
      tabIds: [1, 2],
      expand: true,
    },
  },
  {
    name: 'github.io tabs title as GitHub Pages not Github',
    input: decideInput({
      organizerOn: false,
      focused: false,
      mode: 'sweep',
      tabs: [
        tab(1, 'github.io', 'Transformer Explainer', { active: true, candidate: false }),
        tab(2, 'github.io', 'Docs', { candidate: false }),
      ],
    }),
    expect: {
      types: ['file'],
      createTitle: 'GitHub Pages',
      expand: true,
      tabIds: [1, 2],
    },
  },
  {
    name: 'case-insensitive title match files into existing GitHub group',
    input: decideInput({
      groups: [
        group(10, 'Github', {
          dominantDomain: 'github.com',
          domains: ['github.com'],
          size: 2,
        }),
      ],
      tabs: [tab(1, 'github.com', 'Pull request', { active: true })],
    }),
    expect: {
      types: ['retitle', 'file'],
      retitle: { groupId: 10, title: 'GitHub' },
      expand: true,
      groupId: 10,
      tabIds: [1],
    },
  },
  {
    name: 'a sweep retitles leftover Github on github.com to GitHub',
    input: decideInput({
      organizerOn: false,
      focused: false,
      mode: 'sweep',
      groups: [
        group(10, 'Github', {
          dominantDomain: 'github.com',
          domains: ['github.com'],
          size: 2,
        }),
      ],
      tabs: [
        tab(1, 'github.com', 'Pull request', { groupId: 10, active: true, candidate: false }),
        tab(2, 'github.com', 'Issue list', { groupId: 10, candidate: false }),
      ],
    }),
    expect: {
      types: ['retitle'],
      retitle: { groupId: 10, title: 'GitHub' },
    },
  },
  {
    name: 'a sweep restores DevOps Skills on github.com to GitHub',
    input: decideInput({
      organizerOn: false,
      focused: false,
      mode: 'sweep',
      groups: [
        group(10, 'DevOps Skills', {
          dominantDomain: 'github.com',
          domains: ['github.com'],
          size: 3,
        }),
      ],
      tabs: [
        tab(1, 'github.com', 'Actions', { groupId: 10, active: true, candidate: false }),
        tab(2, 'github.com', 'Pull request', { groupId: 10, candidate: false }),
        tab(3, 'github.com', 'Skills', { groupId: 10, candidate: false }),
      ],
    }),
    expect: {
      types: ['retitle'],
      retitle: { groupId: 10, title: 'GitHub' },
    },
  },
  {
    name: 'a sweep keeps a rule title and does not restore GitHub over gb',
    input: decideInput({
      organizerOn: false,
      focused: false,
      mode: 'sweep',
      rules: [githubRule],
      groups: [
        group(10, 'gb', {
          dominantDomain: 'github.com',
          domains: ['github.com'],
          size: 2,
        }),
      ],
      tabs: [
        tab(1, 'github.com', 'Pull request', { groupId: 10, active: true, candidate: false }),
        tab(2, 'github.com', 'Issue list', { groupId: 10, candidate: false }),
      ],
    }),
    expect: { types: [] },
  },
  {
    name: 'a sweep retitles leftover Github on github.io to GitHub Pages',
    input: decideInput({
      organizerOn: false,
      focused: false,
      mode: 'sweep',
      groups: [
        group(11, 'Github', {
          dominantDomain: 'github.io',
          domains: ['github.io'],
          size: 1,
        }),
      ],
      tabs: [tab(1, 'github.io', 'Transformer Explainer', { groupId: 11, active: true, candidate: false })],
    }),
    expect: {
      types: ['retitle'],
      retitle: { groupId: 11, title: 'GitHub Pages' },
    },
  },
  {
    name: 'a sweep groups every loose tab and opens only the active group',
    input: decideInput({
      organizerOn: false,
      focused: false,
      mode: 'sweep',
      tabs: [
        tab(1, 'github.com', 'Pull request', { active: true }),
        tab(2, 'github.com', 'Issue list'),
        tab(3, 'amazon.com', 'USB cable'),
        tab(4, 'example.com', 'City election'),
      ],
    }),
    expect: {
      types: ['file', 'file', 'file'],
      files: [
        { createTitle: 'GitHub', expand: true, tabIds: [1, 2] },
        { createTitle: 'Amazon', expand: false, tabIds: [3] },
        { createTitle: 'Example', expand: false, tabIds: [4] },
      ],
    },
  },
  {
    name: 'a sweep merges tabs that share a subject',
    input: decideInput({
      organizerOn: false,
      mode: 'sweep',
      tabs: [
        tab(1, 'amazon.com', 'Best standing desk', { active: true }),
        tab(2, 'wirecutter.com', 'Standing desk review'),
      ],
    }),
    expect: {
      types: ['file'],
      createTitle: 'standing desk',
      expand: true,
      tabIds: [1, 2],
    },
  },
  {
    name: 'watch creates a site group for a single new tab',
    input: decideInput({
      tabs: [tab(1, 'amazon.com', 'USB cable', { active: true })],
    }),
    expect: {
      types: ['file'],
      createTitle: 'Amazon',
      expand: true,
      aroundTabId: 1,
      tabIds: [1],
      groupId: null,
    },
  },
  {
    name: 'watch leaves a tab the user dragged into a group',
    input: decideInput({
      groups: [
        group(10, 'GitHub', { dominantDomain: 'github.com', domains: ['github.com'], size: 2 }),
        group(11, 'YouTube', { dominantDomain: 'youtube.com', domains: ['youtube.com'], size: 1 }),
      ],
      tabs: [tab(2, 'github.com', 'Issue list', { sticky: true, groupId: 11, active: true })],
    }),
    expect: { types: [] },
  },
  {
    name: 'a sweep gives one sticky ungrouped tab its own group',
    input: decideInput({
      organizerOn: false,
      focused: false,
      mode: 'sweep',
      tabs: [tab(1, 'amazon.com', 'USB cable', { sticky: true, active: true, candidate: false })],
    }),
    expect: {
      types: ['file'],
      createTitle: 'Amazon',
      expand: true,
      tabIds: [1],
    },
  },
  {
    name: 'a sweep files ungrouped tabs that were marked sticky',
    input: decideInput({
      organizerOn: false,
      focused: false,
      mode: 'sweep',
      tabs: [
        tab(1, 'github.com', 'Pull request', { sticky: true, active: true, candidate: false }),
        tab(2, 'github.com', 'Issue list', { sticky: true, candidate: false }),
      ],
    }),
    expect: {
      types: ['file'],
      createTitle: 'GitHub',
      expand: true,
      tabIds: [1, 2],
    },
  },
  {
    name: 'a sweep files loose tabs and leaves a dragged tab in its group',
    input: decideInput({
      organizerOn: false,
      mode: 'sweep',
      groups: [group(11, 'YouTube', { dominantDomain: 'youtube.com', domains: ['youtube.com'], size: 1 })],
      tabs: [
        tab(2, 'github.com', 'Issue list', { sticky: true, groupId: 11 }),
        tab(3, 'github.com', 'Pull request', { active: true }),
        tab(4, 'github.com', 'Actions log'),
      ],
    }),
    expect: {
      types: ['file'],
      createTitle: 'GitHub',
      expand: true,
      tabIds: [3, 4],
    },
  },
  {
    name: 'a sweep groups duplicate sites and gives each lone site a group',
    input: decideInput({
      organizerOn: false,
      focused: false,
      mode: 'sweep',
      tabs: [
        tab(1, 'github.com', 'Pull request', { active: true, candidate: false }),
        tab(2, 'github.com', 'Issue list', { candidate: false }),
        tab(3, 'github.com', 'Actions log', { candidate: false }),
        tab(4, 'google.com', 'Budget sheet', { candidate: false }),
        tab(5, 'google.com', 'Vacation notes', { candidate: false }),
        tab(6, 'google.com', 'Hiring plan', { candidate: false }),
        tab(7, 'amazon.com', 'USB cable', { candidate: false }),
        tab(8, 'nytimes.com', 'City election', { candidate: false }),
        tab(9, 'github.com', 'Inbox', { pinned: true, candidate: false }),
        tab(10, '', 'Extensions', {
          http: false,
          browserPage: true,
          candidate: false,
          card: card('', 'Extensions'),
        }),
      ],
    }),
    expect: {
      types: ['file', 'file', 'file', 'file'],
      files: [
        { createTitle: 'GitHub', expand: true, tabIds: [1, 2, 3] },
        { createTitle: 'Google', expand: false, tabIds: [4, 5, 6] },
        { createTitle: 'Amazon', expand: false, tabIds: [7] },
        { createTitle: 'New York Times', expand: false, tabIds: [8] },
      ],
    },
  },
  {
    name: 'a sweep files http tabs beside empty-url pinned and browser pages',
    input: decideInput({
      organizerOn: false,
      focused: false,
      mode: 'sweep',
      tabs: [
        tab(1, 'github.com', 'Pull request', { active: true, candidate: false }),
        tab(2, 'github.com', 'Issue list', { candidate: false }),
        tab(3, 'amazon.com', 'USB cable', { candidate: false }),
        tab(4, '', '', {
          http: false,
          browserPage: false,
          candidate: false,
          status: 'loading',
          card: card('', ''),
        }),
        tab(5, 'github.com', 'Inbox', { pinned: true, candidate: false }),
        tab(6, '', 'Extensions', {
          http: false,
          browserPage: true,
          candidate: false,
          card: card('', 'Extensions'),
        }),
      ],
    }),
    expect: {
      types: ['file', 'file'],
      files: [
        { createTitle: 'GitHub', expand: true, tabIds: [1, 2] },
        { createTitle: 'Amazon', expand: false, tabIds: [3] },
      ],
    },
  },
  {
    name: 'a sweep files a lone localhost tab into the shared Local group',
    input: decideInput({
      organizerOn: false,
      focused: false,
      mode: 'sweep',
      tabs: [tab(1, 'localhost', 'OmniRoute', { active: true, candidate: false })],
    }),
    expect: {
      types: ['file'],
      createTitle: 'Local',
      expand: true,
      tabIds: [1],
    },
  },
  {
    name: 'a sweep files a lone 127.0.0.1 tab as Local (never 127)',
    input: decideInput({
      organizerOn: false,
      focused: false,
      mode: 'sweep',
      tabs: [
        tab(1, 'localhost', 'App', {
          active: true,
          candidate: false,
          card: card('localhost', 'App'),
        }),
      ],
    }),
    expect: {
      types: ['file'],
      createTitle: 'Local',
      expand: true,
      tabIds: [1],
    },
  },
  {
    name: 'a sweep retitles a leftover 127 loopback group to Local',
    input: decideInput({
      organizerOn: false,
      focused: false,
      mode: 'sweep',
      groups: [
        group(10, '127', {
          dominantDomain: 'localhost',
          domains: ['localhost'],
          size: 2,
        }),
      ],
      tabs: [
        tab(1, 'localhost', 'App A', { groupId: 10, active: true, candidate: false }),
        tab(2, 'localhost', 'App B', { groupId: 10, candidate: false }),
      ],
    }),
    expect: {
      types: ['retitle'],
      retitle: { groupId: 10, title: 'Local' },
    },
  },
  {
    name: 'a sweep restores a thematic Local title to Local',
    input: decideInput({
      organizerOn: false,
      focused: false,
      mode: 'sweep',
      groups: [
        group(10, 'Dev Dashboard', {
          dominantDomain: 'localhost',
          domains: ['localhost'],
          size: 2,
        }),
      ],
      tabs: [
        tab(1, 'localhost', 'App A', { groupId: 10, active: true, candidate: false }),
        tab(2, 'localhost', 'App B', { groupId: 10, candidate: false }),
      ],
    }),
    expect: {
      types: ['retitle'],
      retitle: { groupId: 10, title: 'Local' },
    },
  },
  {
    name: 'a sweep skips pinned tabs and browser pages',
    input: decideInput({
      organizerOn: false,
      mode: 'sweep',
      tabs: [
        tab(1, 'github.com', 'Inbox', { pinned: true, active: true }),
        tab(2, '', 'Extensions', { http: false, browserPage: true, card: card('', 'Extensions') }),
      ],
    }),
    expect: { types: [] },
  },
  {
    name: 'an incognito tab is skipped on a sweep',
    input: decideInput({
      organizerOn: false,
      mode: 'sweep',
      tabs: [tab(1, 'github.com', 'Pull request', { incognito: true, active: true })],
    }),
    expect: { types: [] },
  },
]
