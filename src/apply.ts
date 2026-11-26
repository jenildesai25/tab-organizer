import type { FileAction, RetitleAction } from './domain/types.js'

export async function retitleGroup(action: RetitleAction, markGroup: (groupId: number) => void): Promise<void> {
  markGroup(action.groupId)
  await chrome.tabGroups.update(action.groupId, { title: action.title, color: action.color })
}

export async function fileTabs(
  windowId: number,
  action: FileAction,
  markTabs: (tabIds: number[]) => void,
  markGroup: (groupId: number) => void,
): Promise<void> {
  markTabs(action.tabIds)
  if (action.create) {
    const anchor = action.create.aroundTabId
    const rest = action.tabIds.filter((id) => id !== anchor)
    const groupId = await chrome.tabs.group({
      createProperties: { windowId },
      tabIds: [anchor],
    })
    markGroup(groupId)
    await chrome.tabGroups.update(groupId, {
      title: action.create.title,
      color: action.create.color,
      collapsed: !action.expand,
    })
    if (rest.length > 0) {
      markTabs(rest)
      await chrome.tabs.group({ groupId, tabIds: tabIdList(rest) })
    }
    return
  }
  if (action.groupId === null) return
  markGroup(action.groupId)
  if (action.expand) await chrome.tabGroups.update(action.groupId, { collapsed: false })
  await chrome.tabs.group({ groupId: action.groupId, tabIds: tabIdList(action.tabIds) })
}

function tabIdList(ids: number[]): [number, ...number[]] {
  const [first, ...rest] = ids
  if (first === undefined) throw new Error('No tabs to group')
  return [first, ...rest]
}
