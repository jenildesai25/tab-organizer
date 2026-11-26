import {
  chromeTabSnapshot,
  normalizeGroupId,
  type ChromeTabLike,
  type TabClass,
} from './chrome-tab.js'
import { countSweep, formatSweepDiag, type SweepDiagCounts } from './summary.js'
import type { TabState } from './types.js'

/** Live Chrome samples attached to sweep responses for browser smoke / debugging. */
export type SweepDiagSample = {
  id: number
  url: string
  pendingUrl: string
  title: string
  kind: TabClass
  groupId: number | null
  discarded: boolean
  status: string
}

export type SweepDiag = {
  version: string
  windowId: number
  looked: number
  eligible: number
  http: number
  samples: SweepDiagSample[]
  /** Same line appended to the popup summary. */
  line: string
}

export function buildSweepDiag(
  version: string,
  windowId: number,
  chromeTabs: ChromeTabLike[],
  states: TabState[],
  noneGroupId = -1,
  sampleLimit = 16,
): SweepDiag {
  const counts = countSweep(states, [])
  const http = states.filter((tab) => tab.http && !tab.pinned && !tab.incognito).length
  const samples: SweepDiagSample[] = []
  for (const tab of chromeTabs) {
    if (tab.id == null || samples.length >= sampleLimit) continue
    const snap = chromeTabSnapshot(tab)
    samples.push({
      id: tab.id,
      url: tab.url || '',
      pendingUrl: tab.pendingUrl || '',
      title: tab.title || '',
      kind: snap.kind,
      groupId: normalizeGroupId(tab.groupId, noneGroupId),
      discarded: tab.discarded === true,
      status: tab.status || '',
    })
  }
  return {
    version,
    windowId,
    looked: counts.looked || states.length,
    eligible: counts.eligible,
    http,
    samples,
    line: formatSweepDiag(chromeTabs),
  }
}

/** @deprecated Prefer formatSweepDiag from summary.ts. */
export function sweepDiagLine(chromeTabs: ChromeTabLike[], sampleLimit = 3): string {
  return formatSweepDiag(chromeTabs, sampleLimit)
}

export type { SweepDiagCounts }
