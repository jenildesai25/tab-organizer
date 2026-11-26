import {
  chromeTabSnapshot,
  normalizeGroupId,
  type ChromeTabLike,
  type TabClass,
} from './chrome-tab.js'
import { countSweep, formatSweepDiag, type SweepDiagCounts } from './summary.js'
import type { TabState } from './types.js'

/** Live Chrome samples — for local smoke/debug only; omitted from production responses. */
export type SweepDiagSample = {
  id: number
  /** Hostname (http/https) or scheme host; never a full path/query URL. */
  host: string
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
  /** Present only when `includeSamples` is requested (dev/smoke). */
  samples?: SweepDiagSample[]
  /** Same line appended to the popup summary. */
  line: string
}

export type BuildSweepDiagOptions = {
  /** When true, attach redacted host samples for local debugging / smoke. Default false. */
  includeSamples?: boolean
  sampleLimit?: number
}

function sampleHost(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) return '(empty)'
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.hostname || '(empty)'
    }
    if (parsed.hostname) return `${parsed.protocol}//${parsed.hostname}`
    return parsed.protocol.replace(/:$/, '') || '(empty)'
  } catch {
    return '(empty)'
  }
}

export function buildSweepDiag(
  version: string,
  windowId: number,
  chromeTabs: ChromeTabLike[],
  states: TabState[],
  noneGroupId = -1,
  options: BuildSweepDiagOptions = {},
): SweepDiag {
  const includeSamples = options.includeSamples === true
  const sampleLimit = options.sampleLimit ?? 16
  const counts = countSweep(states, [])
  const http = states.filter((tab) => tab.http && !tab.pinned && !tab.incognito).length
  const diag: SweepDiag = {
    version,
    windowId,
    looked: counts.looked || states.length,
    eligible: counts.eligible,
    http,
    line: formatSweepDiag(chromeTabs),
  }
  if (!includeSamples) return diag

  const samples: SweepDiagSample[] = []
  for (const tab of chromeTabs) {
    if (tab.id == null || samples.length >= sampleLimit) continue
    const snap = chromeTabSnapshot(tab)
    samples.push({
      id: tab.id,
      host: sampleHost(tab.url || tab.pendingUrl || ''),
      kind: snap.kind,
      groupId: normalizeGroupId(tab.groupId, noneGroupId),
      discarded: tab.discarded === true,
      status: tab.status || '',
    })
  }
  diag.samples = samples
  return diag
}

/** @deprecated Prefer formatSweepDiag from summary.ts. */
export function sweepDiagLine(chromeTabs: ChromeTabLike[], sampleLimit = 3): string {
  return formatSweepDiag(chromeTabs, sampleLimit)
}

export type { SweepDiagCounts }
