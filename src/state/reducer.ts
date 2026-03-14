import type { AppSnapshot, AppSpace, AppTab, AppTabType } from '../types/opensmith'
import { createTab } from './tabFactory'

type Action =
  | { type: 'replace'; value: AppSnapshot }
  | { type: 'add-space'; space: AppSpace }
  | { type: 'set-active-space'; spaceId: string }
  | { type: 'add-tab'; spaceId: string; tabType: AppTabType }
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

export function appReducer(state: AppSnapshot, action: Action): AppSnapshot {
  if (action.type === 'replace') {
    return action.value
  }

  if (action.type === 'add-space') {
    return {
      ...state,
      spaces: [...state.spaces, action.space],
      activeSpaceId: action.space.id,
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
      const tab = createTab(action.tabType, space.rootPath)
      return {
        ...space,
        tabs: [...space.tabs, tab],
        activeTabId: tab.id,
      }
    })
  }

  if (action.type === 'set-active-tab') {
    return updateSpace(state, action.spaceId, (space) => ({
      ...space,
      activeTabId: action.tabId,
    }))
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
      const fallbackTab = nextTabs.at(0)
      return {
        ...space,
        tabs: nextTabs,
        activeTabId: space.activeTabId === action.tabId ? fallbackTab?.id ?? '' : space.activeTabId,
        secondaryTabId: space.secondaryTabId === action.tabId ? null : space.secondaryTabId,
      }
    })
  }

  return state
}

export type AppAction = Action
