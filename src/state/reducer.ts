import type { AppSnapshot, AppSpace, AppTab, AppTabType } from '../types/opensmith'
import { createTab } from './tabFactory'

type Action =
  | { type: 'replace'; value: AppSnapshot }
  | { type: 'add-space'; space: AppSpace }
  | { type: 'rename-space'; spaceId: string; name: string }
  | { type: 'delete-space'; spaceId: string }
  | { type: 'set-active-space'; spaceId: string }
  | { type: 'add-tab'; spaceId: string; tabType: AppTabType }
  | { type: 'insert-tab-after'; spaceId: string; afterTabId: string; tab: AppTab; activate?: boolean }
  | { type: 'set-active-tab'; spaceId: string; tabId: string }
  | { type: 'reorder-tab'; spaceId: string; sourceTabId: string; targetTabId: string }
  | { type: 'set-secondary-tab'; spaceId: string; tabId: string | null }
  | { type: 'update-tab'; spaceId: string; tabId: string; updater: (tab: AppTab) => AppTab }
  | { type: 'close-tab'; spaceId: string; tabId: string }

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
        tabHistory: nextHistory,
      }
    })
  }

  return state
}

export type AppAction = Action
