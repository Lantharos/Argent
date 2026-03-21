import type { AppSnapshot, AppSpace, AppTab, AppTabGroup, AppTabSplitNode, AppTabType, EssentialTab, SplitOrientation } from '../types/argent'
import { createId } from './ids'
import { createTab } from './tabFactory'

type Action =
  | { type: 'replace'; value: AppSnapshot }
  | { type: 'set-compact-sidebar'; value: boolean }
  | { type: 'add-space'; space: AppSpace }
  | { type: 'rename-space'; spaceId: string; name: string }
  | { type: 'delete-space'; spaceId: string }
  | { type: 'set-active-space'; spaceId: string }
  | { type: 'add-tab'; spaceId: string; tabType: AppTabType }
  | { type: 'insert-tab-after'; spaceId: string; afterTabId: string; tab: AppTab; activate?: boolean }
  | { type: 'set-active-tab'; spaceId: string; tabId: string }
  | { type: 'reorder-tab'; spaceId: string; sourceTabId: string; targetTabId: string }
  | {
      type: 'split-tab'
      spaceId: string
      sourceTabId: string
      targetTabId: string
      direction: 'left' | 'right' | 'top' | 'bottom'
    }
  | { type: 'set-split-ratio'; spaceId: string; branchId: string; ratio: number }
  | { type: 'set-secondary-tab'; spaceId: string; tabId: string | null }
  | { type: 'update-tab'; spaceId: string; tabId: string; updater: (tab: AppTab) => AppTab }
  | { type: 'close-tab'; spaceId: string; tabId: string }
  | { type: 'add-essential-tab'; tab: EssentialTab }
  | { type: 'remove-essential-tab'; tabId: string }
  | { type: 'update-essential-tab'; tabId: string; updater: (tab: EssentialTab) => EssentialTab }

function updateSpace(state: AppSnapshot, spaceId: string, updater: (space: AppSpace) => AppSpace): AppSnapshot {
  return {
    ...state,
    spaces: state.spaces.map((space) => (space.id === spaceId ? updater(space) : space)),
  }
}

function recordTabVisit(history: string[] | undefined, tabId: string): string[] {
  const nextHistory = (history ?? []).filter((id) => id !== tabId)
  nextHistory.push(tabId)
  return nextHistory
}

function removeFromHistory(history: string[] | undefined, tabId: string): string[] {
  return (history ?? []).filter((id) => id !== tabId)
}

function collectSplitTabIds(node: AppTabSplitNode, out: Set<string>) {
  if (node.type === 'leaf') {
    out.add(node.tabId)
    return
  }

  collectSplitTabIds(node.first, out)
  collectSplitTabIds(node.second, out)
}

function countSplitLeaves(node: AppTabSplitNode): number {
  const ids = new Set<string>()
  collectSplitTabIds(node, ids)
  return ids.size
}

function normalizeSplitNode(node: AppTabSplitNode, tabIds: Set<string>, used: Set<string>): AppTabSplitNode | null {
  if (node.type === 'leaf') {
    if (!tabIds.has(node.tabId) || used.has(node.tabId)) {
      return null
    }
    used.add(node.tabId)
    return node
  }

  const first = normalizeSplitNode(node.first, tabIds, used)
  const second = normalizeSplitNode(node.second, tabIds, used)

  if (!first && !second) {
    return null
  }
  if (!first) {
    return second
  }
  if (!second) {
    return first
  }

  return {
    ...node,
    first,
    second,
  }
}

function normalizeTabGroups(space: AppSpace): AppTabGroup[] {
  const tabIds = new Set(space.tabs.map((tab) => tab.id))
  const used = new Set<string>()
  const nextGroups: AppTabGroup[] = []

  for (const group of space.tabGroups ?? []) {
    const root = normalizeSplitNode(group.root, tabIds, used)
    if (!root) {
      continue
    }
    if (countSplitLeaves(root) < 2) {
      continue
    }
    nextGroups.push({ ...group, root })
  }

  return nextGroups
}

function splitNodeContainsTab(node: AppTabSplitNode, tabId: string): boolean {
  if (node.type === 'leaf') {
    return node.tabId === tabId
  }

  return splitNodeContainsTab(node.first, tabId) || splitNodeContainsTab(node.second, tabId)
}

function removeTabFromSplitNode(node: AppTabSplitNode, tabId: string): { node: AppTabSplitNode | null; removed: boolean } {
  if (node.type === 'leaf') {
    if (node.tabId !== tabId) {
      return { node, removed: false }
    }
    return { node: null, removed: true }
  }

  const nextFirst = removeTabFromSplitNode(node.first, tabId)
  if (nextFirst.removed) {
    if (!nextFirst.node) {
      return { node: node.second, removed: true }
    }
    return {
      node: {
        ...node,
        first: nextFirst.node,
      },
      removed: true,
    }
  }

  const nextSecond = removeTabFromSplitNode(node.second, tabId)
  if (!nextSecond.removed) {
    return { node, removed: false }
  }

  if (!nextSecond.node) {
    return { node: node.first, removed: true }
  }

  return {
    node: {
      ...node,
      second: nextSecond.node,
    },
    removed: true,
  }
}

function insertTabAroundTarget(
  node: AppTabSplitNode,
  targetTabId: string,
  sourceTabId: string,
  orientation: SplitOrientation,
  place: 'before' | 'after',
): { node: AppTabSplitNode; inserted: boolean } {
  if (node.type === 'leaf') {
    if (node.tabId !== targetTabId) {
      return { node, inserted: false }
    }

    const sourceLeaf: AppTabSplitNode = {
      id: createId('split-leaf'),
      type: 'leaf',
      tabId: sourceTabId,
    }

    return {
      node: {
        id: createId('split-branch'),
        type: 'split',
        orientation,
        ratio: 0.5,
        first: place === 'before' ? sourceLeaf : node,
        second: place === 'before' ? node : sourceLeaf,
      },
      inserted: true,
    }
  }

  const nextFirst = insertTabAroundTarget(node.first, targetTabId, sourceTabId, orientation, place)
  if (nextFirst.inserted) {
    return {
      node: {
        ...node,
        first: nextFirst.node,
      },
      inserted: true,
    }
  }

  const nextSecond = insertTabAroundTarget(node.second, targetTabId, sourceTabId, orientation, place)
  if (!nextSecond.inserted) {
    return { node, inserted: false }
  }

  return {
    node: {
      ...node,
      second: nextSecond.node,
    },
    inserted: true,
  }
}

function detachTabFromGroups(groups: AppTabGroup[], tabId: string): AppTabGroup[] {
  const nextGroups: AppTabGroup[] = []

  for (const group of groups) {
    const next = removeTabFromSplitNode(group.root, tabId)
    if (!next.removed || !next.node) {
      if (countSplitLeaves(group.root) >= 2) {
        nextGroups.push(group)
      }
      continue
    }

    if (countSplitLeaves(next.node) >= 2) {
      nextGroups.push({
        ...group,
        root: next.node,
      })
    }
  }

  return nextGroups
}

function findGroupIndexByTab(groups: AppTabGroup[], tabId: string): number {
  return groups.findIndex((group) => splitNodeContainsTab(group.root, tabId))
}

function splitDirectionToPlacement(direction: 'left' | 'right' | 'top' | 'bottom'): {
  orientation: SplitOrientation
  place: 'before' | 'after'
} {
  if (direction === 'left') {
    return { orientation: 'vertical', place: 'before' }
  }
  if (direction === 'right') {
    return { orientation: 'vertical', place: 'after' }
  }
  if (direction === 'top') {
    return { orientation: 'horizontal', place: 'before' }
  }
  return { orientation: 'horizontal', place: 'after' }
}

function updateSplitRatioInNode(node: AppTabSplitNode, branchId: string, ratio: number): { node: AppTabSplitNode; updated: boolean } {
  if (node.type === 'leaf') {
    return { node, updated: false }
  }

  const clampedRatio = Math.max(0.16, Math.min(0.84, ratio))
  if (node.id === branchId) {
    return {
      node: {
        ...node,
        ratio: clampedRatio,
      },
      updated: true,
    }
  }

  const nextFirst = updateSplitRatioInNode(node.first, branchId, clampedRatio)
  if (nextFirst.updated) {
    return {
      node: {
        ...node,
        first: nextFirst.node,
      },
      updated: true,
    }
  }

  const nextSecond = updateSplitRatioInNode(node.second, branchId, clampedRatio)
  if (nextSecond.updated) {
    return {
      node: {
        ...node,
        second: nextSecond.node,
      },
      updated: true,
    }
  }

  return { node, updated: false }
}

function normalizeSpace(space: AppSpace): AppSpace {
  const normalizedKind = space.kind ?? 'project'
  const normalizedTabs =
    normalizedKind === 'global'
      ? space.tabs.filter((tab) => tab.type !== 'git' && tab.type !== 'editor')
      : space.tabs

  const tabIds = new Set(normalizedTabs.map((tab) => tab.id))
  const historyFromState = (space.tabHistory ?? []).filter((id) => tabIds.has(id))
  const activeFallback = tabIds.has(space.activeTabId) ? space.activeTabId : normalizedTabs.at(0)?.id ?? ''
  return {
    ...space,
    kind: normalizedKind,
    tabs: normalizedTabs,
    activeTabId: activeFallback,
    tabGroups: normalizeTabGroups({
      ...space,
      tabs: normalizedTabs,
    }),
    tabHistory: activeFallback ? recordTabVisit(historyFromState, activeFallback) : historyFromState,
  }
}

function findLastUsedAiSettings(state: AppSnapshot, activeSpaceId: string) {
  const activeSpace = state.spaces.find((space) => space.id === activeSpaceId)
  if (activeSpace) {
    const activeTab = activeSpace.tabs.find((tab) => tab.id === activeSpace.activeTabId)
    if (activeTab?.type === 'ai') {
      return {
        model: activeTab.model,
        providerId: activeTab.providerId,
      }
    }
  }

  for (let spaceIndex = state.spaces.length - 1; spaceIndex >= 0; spaceIndex -= 1) {
    const space = state.spaces[spaceIndex]
    for (let tabIndex = space.tabs.length - 1; tabIndex >= 0; tabIndex -= 1) {
      const tab = space.tabs[tabIndex]
      if (tab.type === 'ai' && (tab.model || tab.providerId)) {
        return {
          model: tab.model,
          providerId: tab.providerId,
        }
      }
    }
  }

  return {
    model: null,
    providerId: 'opencode-acp',
  }
}

export function appReducer(state: AppSnapshot, action: Action): AppSnapshot {
  if (action.type === 'replace') {
    return {
      ...action.value,
      spaces: action.value.spaces.map(normalizeSpace),
      compactSidebar: action.value.compactSidebar ?? false,
      essentialTabs: action.value.essentialTabs ?? [],
    }
  }

  if (action.type === 'set-compact-sidebar') {
    return {
      ...state,
      compactSidebar: action.value,
    }
  }

  if (action.type === 'add-space') {
    const space = normalizeSpace(action.space)
    return {
      ...state,
      spaces: [...state.spaces, space],
      activeSpaceId: space.id,
    }
  }

  if (action.type === 'rename-space') {
    return updateSpace(state, action.spaceId, (space) => ({
      ...space,
      name: action.name,
    }))
  }

  if (action.type === 'delete-space') {
    const nextSpaces = state.spaces.filter((space) => space.id !== action.spaceId)
    if (nextSpaces.length === 0) {
      return {
        ...state,
        spaces: [],
        activeSpaceId: null,
      }
    }

    const nextActiveId =
      state.activeSpaceId && state.activeSpaceId !== action.spaceId && nextSpaces.some((space) => space.id === state.activeSpaceId)
        ? state.activeSpaceId
        : nextSpaces[0].id

    return {
      ...state,
      spaces: nextSpaces,
      activeSpaceId: nextActiveId,
    }
  }

  if (action.type === 'set-active-space') {
    return {
      ...state,
      activeSpaceId: action.spaceId,
    }
  }

  if (action.type === 'add-tab') {
    return updateSpace(state, action.spaceId, (space) => {
      if ((space.kind ?? 'project') === 'global' && (action.tabType === 'git' || action.tabType === 'editor')) {
        return space
      }

      const tab = createTab(action.tabType, space.rootPath)
      const aiDefaults = findLastUsedAiSettings(state, action.spaceId)
      const nextTab =
        tab.type === 'ai'
          ? {
              ...tab,
              providerId: aiDefaults.providerId || 'opencode-acp',
              model: aiDefaults.model,
            }
          : tab

      return {
        ...space,
        tabs: [...space.tabs, nextTab],
        activeTabId: nextTab.id,
        tabHistory: recordTabVisit(space.tabHistory, nextTab.id),
      }
    })
  }

  if (action.type === 'set-active-tab') {
    return updateSpace(state, action.spaceId, (space) => ({
      ...space,
      activeTabId: action.tabId,
      tabHistory: recordTabVisit(space.tabHistory, action.tabId),
    }))
  }

  if (action.type === 'insert-tab-after') {
    return updateSpace(state, action.spaceId, (space) => {
      const afterIndex = space.tabs.findIndex((tab) => tab.id === action.afterTabId)
      const insertIndex = afterIndex >= 0 ? afterIndex + 1 : space.tabs.length
      const nextTabs = [...space.tabs]
      nextTabs.splice(insertIndex, 0, action.tab)

      return {
        ...space,
        tabs: nextTabs,
        activeTabId: action.activate === false ? space.activeTabId : action.tab.id,
        tabHistory: action.activate === false ? space.tabHistory ?? [] : recordTabVisit(space.tabHistory, action.tab.id),
      }
    })
  }

  if (action.type === 'reorder-tab') {
    return updateSpace(state, action.spaceId, (space) => {
      const fromIndex = space.tabs.findIndex((tab) => tab.id === action.sourceTabId)
      const targetIndex = space.tabs.findIndex((tab) => tab.id === action.targetTabId)
      if (fromIndex < 0 || targetIndex < 0 || fromIndex === targetIndex) {
        return space
      }

      const nextTabs = [...space.tabs]
      const [moved] = nextTabs.splice(fromIndex, 1)
      nextTabs.splice(targetIndex, 0, moved)

      return {
        ...space,
        tabs: nextTabs,
      }
    })
  }

  if (action.type === 'split-tab') {
    return updateSpace(state, action.spaceId, (space) => {
      if (action.sourceTabId === action.targetTabId) {
        return space
      }

      const hasSource = space.tabs.some((tab) => tab.id === action.sourceTabId)
      const hasTarget = space.tabs.some((tab) => tab.id === action.targetTabId)
      if (!hasSource || !hasTarget) {
        return space
      }

      const { orientation, place } = splitDirectionToPlacement(action.direction)
      const detachedGroups = detachTabFromGroups(space.tabGroups ?? [], action.sourceTabId)
      const targetGroupIndex = findGroupIndexByTab(detachedGroups, action.targetTabId)
      const nextGroups = [...detachedGroups]

      if (targetGroupIndex >= 0) {
        const targetGroup = nextGroups[targetGroupIndex]
        const inserted = insertTabAroundTarget(targetGroup.root, action.targetTabId, action.sourceTabId, orientation, place)
        if (!inserted.inserted) {
          return space
        }
        nextGroups[targetGroupIndex] = {
          ...targetGroup,
          root: inserted.node,
        }
      } else {
        const sourceLeaf: AppTabSplitNode = {
          id: createId('split-leaf'),
          type: 'leaf',
          tabId: action.sourceTabId,
        }
        const targetLeaf: AppTabSplitNode = {
          id: createId('split-leaf'),
          type: 'leaf',
          tabId: action.targetTabId,
        }

        nextGroups.push({
          id: createId('tab-group'),
          root: {
            id: createId('split-branch'),
            type: 'split',
            orientation,
            ratio: 0.5,
            first: place === 'before' ? sourceLeaf : targetLeaf,
            second: place === 'before' ? targetLeaf : sourceLeaf,
          },
        })
      }

      const normalizedGroups = normalizeTabGroups({
        ...space,
        tabGroups: nextGroups,
      })

      return {
        ...space,
        tabGroups: normalizedGroups,
        activeTabId: action.sourceTabId,
        tabHistory: recordTabVisit(space.tabHistory, action.sourceTabId),
      }
    })
  }

  if (action.type === 'set-split-ratio') {
    return updateSpace(state, action.spaceId, (space) => {
      if (!space.tabGroups?.length) {
        return space
      }

      let updated = false
      const nextGroups = space.tabGroups.map((group) => {
        const nextRoot = updateSplitRatioInNode(group.root, action.branchId, action.ratio)
        if (!nextRoot.updated) {
          return group
        }

        updated = true
        return {
          ...group,
          root: nextRoot.node,
        }
      })

      if (!updated) {
        return space
      }

      return {
        ...space,
        tabGroups: nextGroups,
      }
    })
  }

  if (action.type === 'set-secondary-tab') {
    return updateSpace(state, action.spaceId, (space) => ({
      ...space,
      secondaryTabId: action.tabId,
    }))
  }

  if (action.type === 'update-tab') {
    return updateSpace(state, action.spaceId, (space) => ({
      ...space,
      tabs: space.tabs.map((tab) => (tab.id === action.tabId ? action.updater(tab) : tab)),
    }))
  }

  if (action.type === 'close-tab') {
    return updateSpace(state, action.spaceId, (space) => {
      const nextTabs = space.tabs.filter((tab) => tab.id !== action.tabId)
      const nextIds = new Set(nextTabs.map((tab) => tab.id))
      let nextHistory = removeFromHistory(space.tabHistory, action.tabId).filter((id) => nextIds.has(id))

      let nextActiveId = space.activeTabId
      if (space.activeTabId === action.tabId) {
        nextActiveId = nextHistory.at(-1) ?? nextTabs.at(0)?.id ?? ''
      }

      if (nextActiveId) {
        nextHistory = recordTabVisit(nextHistory, nextActiveId)
      }

      return {
        ...space,
        tabs: nextTabs,
        activeTabId: nextActiveId,
        secondaryTabId: space.secondaryTabId === action.tabId ? null : space.secondaryTabId,
        tabGroups: normalizeTabGroups({
          ...space,
          tabs: nextTabs,
          tabGroups: detachTabFromGroups(space.tabGroups ?? [], action.tabId),
        }),
        tabHistory: nextHistory,
      }
    })
  }

  if (action.type === 'add-essential-tab') {
    return {
      ...state,
      essentialTabs: [...(state.essentialTabs ?? []), action.tab],
    }
  }

  if (action.type === 'remove-essential-tab') {
    return {
      ...state,
      essentialTabs: (state.essentialTabs ?? []).filter((tab) => tab.id !== action.tabId),
    }
  }

  if (action.type === 'update-essential-tab') {
    return {
      ...state,
      essentialTabs: (state.essentialTabs ?? []).map((tab) => (tab.id === action.tabId ? action.updater(tab) : tab)),
    }
  }

  return state
}

export type AppAction = Action
