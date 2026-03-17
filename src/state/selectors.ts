import type { AppSnapshot, AppSpace, AppTab } from '../types/argent'

export function getActiveSpace(state: AppSnapshot): AppSpace | null {
  if (!state.activeSpaceId) {
    return null
  }
  return state.spaces.find((space) => space.id === state.activeSpaceId) ?? null
}

export function getTab(space: AppSpace | null, tabId: string | null): AppTab | null {
  if (!space || !tabId) {
    return null
  }
  return space.tabs.find((tab) => tab.id === tabId) ?? null
}
