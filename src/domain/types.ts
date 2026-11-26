export const CHROME_COLORS = [
  'grey',
  'blue',
  'red',
  'yellow',
  'green',
  'pink',
  'purple',
  'cyan',
  'orange',
] as const

export type ChromeColor = (typeof CHROME_COLORS)[number]

export type FeatureCard = {
  domain: string
  title: string
  titleWords: string[]
  pathWords: string[]
  openerDomain: string | null
}

export type GroupState = {
  id: number
  title: string
  dominantDomain: string | null
  domains: string[]
  words: string[]
  size: number
  collapsed: boolean
  shared: boolean
  handRenamed: boolean
}

export type TabState = {
  id: number
  active: boolean
  pinned: boolean
  incognito: boolean
  http: boolean
  /** True only for a known non-http URL (chrome://, chrome-extension://, …). Empty urls are not browser pages. */
  browserPage: boolean
  sticky: boolean
  openedInsideGroup: boolean
  candidate: boolean
  status: 'loading' | 'complete'
  titleStableSince: number | null
  groupId: number | null
  lastFiledDomain: string | null
  advisorPending: boolean
  card: FeatureCard
}

export type CompiledRule = {
  id: string
  sentence: string
  domains: string[]
  title: string
}

export type Suggestion = {
  tabId: number
  title: string
  confidence: number
}

export type DecideInput = {
  now: number
  organizerOn: boolean
  llmOn: boolean
  mode: 'watch' | 'sweep'
  focused: boolean
  rules: CompiledRule[]
  groups: GroupState[]
  tabs: TabState[]
  suggestion: Suggestion | null
}

export type FileAction = {
  type: 'file'
  tabIds: number[]
  expand: boolean
  groupId: number | null
  create: { title: string; color: ChromeColor; aroundTabId: number } | null
}

export type RetitleAction = {
  type: 'retitle'
  groupId: number
  title: string
  color: ChromeColor
}

export type WaitAction = {
  type: 'wait'
  tabId: number
  readyAt: number | null
}

export type GroupSummary = {
  id: number
  title: string
  domains: string[]
  words: string[]
  size: number
}

export type AskAdvisorAction = {
  type: 'ask-advisor'
  tabId: number
  card: FeatureCard
  groups: GroupSummary[]
}

export type Action = FileAction | RetitleAction | WaitAction | AskAdvisorAction

export const SETTLE_MS = 2000
export const FILE_OVERLAP = 0.5
export const ASK_OVERLAP = 0.25
export const ADVISOR_CONFIDENCE = 0.75
