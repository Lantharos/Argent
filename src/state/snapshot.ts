import type { AppSnapshot, AppSpace } from '../types/argent'
import { createId } from './ids'
import { createTab } from './tabFactory'

export function createSpace(folderPath: string): AppSpace {
  const ai = createTab('ai', folderPath)
  const browser = createTab('browser', folderPath)

  return {
    id: createId('space'),
    name: folderPath.split(/[/\\]/).filter(Boolean).at(-1) ?? 'Workspace',
    rootPath: folderPath,
    kind: 'project',
    collapsed: false,
    tabs: [ai, browser],
    activeTabId: ai.id,
    secondaryTabId: browser.id,
    tabHistory: [ai.id],
  }
}

export function createGlobalSpace(homePath: string): AppSpace {
  const ai = createTab('ai', homePath)
  const browser = createTab('browser', homePath)

  return {
    id: createId('space'),
    name: 'Empty Space',
    rootPath: homePath,
    kind: 'global',
    collapsed: false,
    tabs: [ai, browser],
    activeTabId: ai.id,
    secondaryTabId: browser.id,
    tabHistory: [ai.id],
  }
}

export function createEssentialSpace(homePath: string): AppSpace {
  const browser = createTab('browser', homePath)

  return {
    id: createId('essential'),
    name: 'Essential',
    rootPath: homePath,
    kind: 'global',
    isEssential: true,
    collapsed: false,
    tabs: [browser],
    activeTabId: browser.id,
    secondaryTabId: null,
    tabHistory: [],
  }
}

export function defaultSnapshot(): AppSnapshot {
  return {
    spaces: [],
    activeSpaceId: null,
    compactSidebar: false,
    essentialTabs: [],
    windowMaterial: 'acrylic',
    godotExecutablePath: null,
  }
}
