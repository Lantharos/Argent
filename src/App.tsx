import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type {
  AppSnapshot,
  AppSpace,
  AppTab,
  AppTabGroup,
  AppTabSplitNode,
  AppTabType,
  PromptAttachment,
  ProviderConfig,
} from './types/argent'
import { appReducer } from './state/reducer'
import { defaultSnapshot, createGlobalSpace, createSpace } from './state/snapshot'
import { getActiveSpace, getTab } from './state/selectors'
import { createTab } from './state/tabFactory'
import { detectLanguageFromPath } from './editor/languageRegistry'
import { CommandPalette } from './components/layout/CommandPalette'
import { EmptyState } from './components/layout/EmptyState'
import { SpaceSidebar } from './components/layout/SpaceSidebar'
import { Workspace } from './components/layout/Workspace'
import './App.css'

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) {
    return false
  }

  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  )
}

function getShortcutIndex(event: KeyboardEvent) {
  const { code, key } = event
  if (code.startsWith('Digit') || code.startsWith('Numpad')) {
    const value = Number(code.slice(-1))
    if (Number.isInteger(value) && value >= 0 && value <= 9) {
      return value === 0 ? 9 : value - 1
    }
  }

  if (/^[0-9]$/.test(key)) {
    const value = Number(key)
    return value === 0 ? 9 : value - 1
  }

  return null
}

function collectGroupTabIds(node: AppTabSplitNode, out: string[]) {
  if (node.type === 'leaf') {
    out.push(node.tabId)
    return
  }

  collectGroupTabIds(node.first, out)
  collectGroupTabIds(node.second, out)
}

function getPreferredGroupTabId(space: AppSpace, groupedTabs: AppTab[]): string {
  if (groupedTabs.some((tab) => tab.id === space.activeTabId)) {
    return space.activeTabId
  }

  const history = space.tabHistory ?? []
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const candidate = history[index]
    if (groupedTabs.some((tab) => tab.id === candidate)) {
      return candidate
    }
  }

  return groupedTabs[0]?.id ?? ''
}

function getShortcutTabTargets(space: AppSpace): string[] {
  const groups = space.tabGroups ?? []
  if (groups.length === 0) {
    return space.tabs.map((tab) => tab.id).slice(0, 10)
  }

  const groupByTab = new Map<string, AppTabGroup>()
  for (const group of groups) {
    const ids: string[] = []
    collectGroupTabIds(group.root, ids)
    for (const id of ids) {
      groupByTab.set(id, group)
    }
  }

  const emittedGroups = new Set<string>()
  const targets: string[] = []

  for (const tab of space.tabs) {
    const group = groupByTab.get(tab.id)
    if (!group) {
      targets.push(tab.id)
    } else if (!emittedGroups.has(group.id)) {
      const ids: string[] = []
      collectGroupTabIds(group.root, ids)
      const groupedTabs = space.tabs.filter((entry) => ids.includes(entry.id))
      if (groupedTabs.length < 2) {
        for (const groupedTab of groupedTabs) {
          targets.push(groupedTab.id)
        }
      } else {
        targets.push(getPreferredGroupTabId(space, groupedTabs))
      }
      emittedGroups.add(group.id)
    }

    if (targets.length >= 10) {
      break
    }
  }

  return targets.slice(0, 10)
}

function App() {
  const [state, dispatch] = useReducer(appReducer, defaultSnapshot())
  const [loaded, setLoaded] = useState(false)
  const [bridgeReady, setBridgeReady] = useState(true)
  const [providers, setProviders] = useState<ProviderConfig[]>([])
  const [homeDirectory, setHomeDirectory] = useState('')
  const [isCtrlHeld, setIsCtrlHeld] = useState(false)
  const [compactSidebarRevealed, setCompactSidebarRevealed] = useState(false)
  const [compactSidebarPopoverLocked, setCompactSidebarPopoverLocked] = useState(false)
  const compactSidebarCloseTimerRef = useRef<number | null>(null)
  const compactSidebarHoverFrameRef = useRef<HTMLDivElement | null>(null)
  const compactSidebarPointerRef = useRef<{ x: number; y: number }>({ x: -1, y: -1 })
  const compactSidebarPopoverLockedRef = useRef(false)

  const activeSpace = useMemo(() => getActiveSpace(state), [state])
  const activeTab = useMemo(() => getTab(activeSpace, activeSpace?.activeTabId ?? null), [activeSpace])
  const compactSidebar = state.compactSidebar ?? false

  const clearCompactSidebarCloseTimer = () => {
    if (compactSidebarCloseTimerRef.current !== null) {
      window.clearTimeout(compactSidebarCloseTimerRef.current)
      compactSidebarCloseTimerRef.current = null
    }
  }

  const scheduleCompactSidebarClose = (delay = 140) => {
    if (compactSidebarPopoverLockedRef.current) {
      return
    }
    clearCompactSidebarCloseTimer()
    compactSidebarCloseTimerRef.current = window.setTimeout(() => {
      const frame = compactSidebarHoverFrameRef.current
      if (frame) {
        const bounds = frame.getBoundingClientRect()
        const { x, y } = compactSidebarPointerRef.current
        const pointerInsideFrame = x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom
        if (pointerInsideFrame || compactSidebarPopoverLockedRef.current) {
          compactSidebarCloseTimerRef.current = null
          return
        }
      }
      setCompactSidebarRevealed(false)
      compactSidebarCloseTimerRef.current = null
    }, delay)
  }

  useEffect(() => {
    compactSidebarPopoverLockedRef.current = compactSidebarPopoverLocked
  }, [compactSidebarPopoverLocked])

  useEffect(() => {
    if (!compactSidebar) {
      clearCompactSidebarCloseTimer()
      setCompactSidebarRevealed(false)
      return
    }

    const onMouseMove = (event: MouseEvent) => {
      compactSidebarPointerRef.current = { x: event.clientX, y: event.clientY }
      if (event.screenX <= 2 || event.clientX <= 26) {
        clearCompactSidebarCloseTimer()
        setCompactSidebarRevealed(true)
        return
      }

      if (!compactSidebarRevealed || compactSidebarPopoverLockedRef.current) {
        return
      }

      const frame = compactSidebarHoverFrameRef.current
      if (!frame) {
        scheduleCompactSidebarClose(80)
        return
      }

      const bounds = frame.getBoundingClientRect()
      const pointerInsideFrame =
        event.clientX >= bounds.left && event.clientX <= bounds.right && event.clientY >= bounds.top && event.clientY <= bounds.bottom

      if (pointerInsideFrame) {
        clearCompactSidebarCloseTimer()
      } else {
        scheduleCompactSidebarClose(80)
      }
    }

    const onWindowBlur = () => {
      clearCompactSidebarCloseTimer()
      setCompactSidebarRevealed(false)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('blur', onWindowBlur)
    return () => {
      clearCompactSidebarCloseTimer()
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('blur', onWindowBlur)
    }
  }, [compactSidebar, compactSidebarRevealed])

  useEffect(() => {
    const onSidebarPopoverLock = (event: Event) => {
      const customEvent = event as CustomEvent<{ locked?: boolean }>
      const locked = Boolean(customEvent.detail?.locked)
      if (locked && compactSidebarCloseTimerRef.current !== null) {
        window.clearTimeout(compactSidebarCloseTimerRef.current)
        compactSidebarCloseTimerRef.current = null
      }
      setCompactSidebarPopoverLocked(locked)
      if (locked) {
        setCompactSidebarRevealed(true)
      }
    }

    window.addEventListener('argent:sidebar-popover-lock', onSidebarPopoverLock as EventListener)
    return () => {
      window.removeEventListener('argent:sidebar-popover-lock', onSidebarPopoverLock as EventListener)
    }
  }, [])

  useEffect(() => {
    async function boot() {
      let bridge = window.argent
      if (!bridge?.app) {
        await new Promise((resolve) => {
          window.setTimeout(resolve, 150)
        })
        bridge = window.argent
      }

      if (!bridge?.app) {
        setBridgeReady(false)
        setLoaded(true)
        return
      }

      const [snapshot, providerList, homePath] = await Promise.all([
        bridge.app.loadState(),
        bridge.providers.list(),
        bridge.app.getHomeDirectory(),
      ])
      dispatch({ type: 'replace', value: snapshot as AppSnapshot })
      setProviders(providerList)
      setHomeDirectory(homePath)
      setLoaded(true)
    }

    void boot()
  }, [])

  useEffect(() => {
    if (!loaded) {
      return
    }

    const id = setTimeout(() => {
      void window.argent.app.saveState(state)
    }, 180)

    return () => clearTimeout(id)
  }, [loaded, state])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) {
        return
      }

      if (!event.ctrlKey) {
        return
      }

      setIsCtrlHeld(true)

      const shortcutIndex = getShortcutIndex(event)
      if (shortcutIndex === null) {
        return
      }

      event.preventDefault()

      if (event.shiftKey) {
        const space = state.spaces[shortcutIndex]
        if (!space) {
          return
        }
        dispatch({ type: 'set-active-space', spaceId: space.id })
        return
      }

      const active = getActiveSpace(state)
      if (!active) {
        return
      }

      const tabId = getShortcutTabTargets(active)[shortcutIndex]
      if (!tabId) {
        return
      }

      dispatch({ type: 'set-active-tab', spaceId: active.id, tabId })
    }

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.ctrlKey) {
        return
      }
      setIsCtrlHeld(false)
    }

    const onWindowBlur = () => {
      setIsCtrlHeld(false)
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onWindowBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onWindowBlur)
    }
  }, [state])

  async function addSpaceFromFolder() {
    const folder = await window.argent.app.chooseFolder()
    if (!folder) {
      return false
    }

    const space = createSpace(folder)
    dispatch({ type: 'add-space', space })
    return true
  }

  async function addEmptySpace() {
    const fallbackHome = await window.argent.app.getHomeDirectory()
    const space = createGlobalSpace(homeDirectory || fallbackHome)
    dispatch({ type: 'add-space', space })
    return true
  }

  function isAuthCloneError(text: string) {
    return /authentication failed|could not read username|terminal prompts disabled|password authentication|access denied|permission denied.*(github|gitlab|bitbucket)|invalid username or password/i.test(text)
  }

  async function cloneRepoToSpace(repoUrl: string, selectedParentDir?: string) {
    const parentDir = selectedParentDir || await window.argent.app.chooseFolder()
    if (!parentDir) {
      return { success: false, error: 'Select a destination folder to clone into.', parentDir: null, authRequired: false }
    }

    const result = await window.argent.git.clone({ repoUrl, parentDir })
    if (!result.success || !result.path) {
      const details = `${result.error || ''}\n${result.stderr || ''}\n${result.stdout || ''}`
      return {
        success: false,
        error: result.error || result.stderr || 'Failed to clone repository.',
        parentDir,
        authRequired: isAuthCloneError(details),
      }
    }

    dispatch({ type: 'add-space', space: createSpace(result.path) })
    return { success: true, parentDir, authRequired: false }
  }

  function updateTab(tab: AppTab) {
    if (!activeSpace) {
      return
    }
    dispatch({
      type: 'update-tab',
      spaceId: activeSpace.id,
      tabId: tab.id,
      updater: () => tab,
    })
  }

  function createTabFromPalette(spaceId: string, tabType: AppTabType, patch?: Partial<AppTab>) {
    const space = state.spaces.find((item) => item.id === spaceId)
    if (!space) {
      return
    }

    const activeAiTab = space.tabs.find(
      (tab): tab is Extract<AppTab, { type: 'ai' }> => tab.id === space.activeTabId && tab.type === 'ai',
    )
    const latestAiTab = state.spaces
      .flatMap((entry) => entry.tabs)
      .reverse()
      .find((tab): tab is Extract<AppTab, { type: 'ai' }> => tab.type === 'ai')

    const baseTab = createTab(tabType, space.rootPath)
    const nextTab =
      baseTab.type === 'ai'
        ? {
            ...baseTab,
            providerId: activeAiTab?.providerId ?? latestAiTab?.providerId ?? 'opencode-acp',
            model: activeAiTab?.model ?? latestAiTab?.model ?? null,
          }
        : baseTab

    const afterTabId = space.activeTabId || space.tabs.at(-1)?.id || nextTab.id
    dispatch({
      type: 'insert-tab-after',
      spaceId,
      afterTabId,
      tab: {
        ...nextTab,
        ...patch,
      } as AppTab,
      activate: true,
    })
    dispatch({ type: 'set-active-space', spaceId })
  }

  function openEditorFileInNewTab(spaceId: string, afterTabId: string, filePath: string, content: string, language?: string) {
    const space = state.spaces.find((item) => item.id === spaceId)
    if (!space) {
      return
    }

    const baseTab = createTab('editor', space.rootPath)
    if (baseTab.type !== 'editor') {
      return
    }

    const title = filePath.split(/[/\\]/).at(-1) ?? 'Editor'
    const nextTab: AppTab = {
      ...baseTab,
      title,
      filePath,
      content,
      language: language ?? detectLanguageFromPath(filePath).id,
      dirty: false,
    }

    dispatch({
      type: 'insert-tab-after',
      spaceId,
      afterTabId,
      tab: nextTab,
      activate: true,
    })
    dispatch({ type: 'set-active-space', spaceId })
  }

  async function sendAI(
    providerId: string,
    messages: { role: 'user' | 'assistant'; content: string }[],
    cwd?: string,
    model?: string,
    attachments?: PromptAttachment[],
  ) {
    const reply = await window.argent.ai.sendMessage({ providerId, messages, cwd, model, attachments })
    return reply.content
  }

  function splitTab(spaceId: string, sourceTabId: string, targetTabId: string, direction: 'left' | 'right' | 'top' | 'bottom') {
    dispatch({
      type: 'split-tab',
      spaceId,
      sourceTabId,
      targetTabId,
      direction,
    })
    dispatch({ type: 'set-active-space', spaceId })
  }

  function setSplitRatio(spaceId: string, branchId: string, ratio: number) {
    dispatch({
      type: 'set-split-ratio',
      spaceId,
      branchId,
      ratio,
    })
  }

  function selectWorkspaceTab(spaceId: string, tabId: string) {
    dispatch({ type: 'set-active-space', spaceId })
    dispatch({ type: 'set-active-tab', spaceId, tabId })
  }

  if (!loaded) {
    return (
      <div className="grid min-h-screen place-items-center bg-transparent">
        <Loader2 className="h-7 w-7 animate-spin text-[#cfcfcf]" aria-hidden="true" />
      </div>
    )
  }

  if (!bridgeReady) {
    return (
      <div className="grid min-h-screen place-items-center bg-transparent">
        <p className="text-center text-sm text-[#cfcfcf]">
          It seems like the Argent bridge is not available. Please make sure you are running this app within the Argent environment.
        </p>
      </div>
    )
  }

  const sidebar = (
    <SpaceSidebar
      spaces={state.spaces}
      activeSpaceId={state.activeSpaceId}
      compactMode={compactSidebar}
      showShortcutHints={isCtrlHeld}
      onActivateSpace={(spaceId: string) => dispatch({ type: 'set-active-space', spaceId })}
      onAddSpaceFromFolder={addSpaceFromFolder}
      onAddEmptySpace={addEmptySpace}
      onCloneRepo={cloneRepoToSpace}
      onRenameSpace={(spaceId: string, name: string) => dispatch({ type: 'rename-space', spaceId, name })}
      onDeleteSpace={(spaceId: string) => dispatch({ type: 'delete-space', spaceId })}
      onOpenSpaceInExplorer={(spaceId: string) => {
        const target = state.spaces.find((space) => space.id === spaceId)
        if (!target) {
          return Promise.resolve(false)
        }
        return window.argent.app.openInExplorer(target.rootPath)
      }}
      onAddTab={(spaceId: string, tabType: AppTabType) => {
        dispatch({ type: 'add-tab', spaceId, tabType })
        dispatch({ type: 'set-active-space', spaceId })
      }}
      onSelectTab={(spaceId: string, tabId: string) => {
        dispatch({ type: 'set-active-space', spaceId })
        dispatch({ type: 'set-active-tab', spaceId, tabId })
      }}
      onReorderTabs={(spaceId: string, sourceTabId: string, targetTabId: string) => {
        dispatch({ type: 'reorder-tab', spaceId, sourceTabId, targetTabId })
      }}
      onCloseTab={(spaceId: string, tabId: string) => {
        dispatch({ type: 'close-tab', spaceId, tabId })
      }}
      onRenameTab={(spaceId: string, tabId: string, title: string) => {
        dispatch({
          type: 'update-tab',
          spaceId,
          tabId,
          updater: (tab) => ({
            ...tab,
            title,
          }),
        })
      }}
    />
  )

  return (
    <main className="app-shell">
      {!compactSidebar ? sidebar : null}

      {activeSpace ? (
        <Workspace
          space={activeSpace}
          activeTab={activeTab}
          providers={providers}
          onUpdateTab={updateTab}
          onOpenEditorFileInNewTab={openEditorFileInNewTab}
          onSendAI={sendAI}
          onSplitTab={splitTab}
          onSetSplitRatio={setSplitRatio}
          onSelectWorkspaceTab={selectWorkspaceTab}
        />
      ) : (
        <div className="workspace">
          <EmptyState onCreateSpace={addSpaceFromFolder} />
        </div>
      )}

      {compactSidebar ? (
        <div className="pointer-events-none absolute inset-0 z-[70]">
          <div
            className="pointer-events-auto absolute inset-y-0 left-0 w-8"
            onPointerEnter={() => {
              clearCompactSidebarCloseTimer()
              setCompactSidebarRevealed(true)
            }}
            onPointerMove={(event) => {
              compactSidebarPointerRef.current = { x: event.clientX, y: event.clientY }
              clearCompactSidebarCloseTimer()
              setCompactSidebarRevealed(true)
            }}
          />
          <div
            ref={compactSidebarHoverFrameRef}
            className={`absolute inset-y-0 left-0 pl-3 pr-2 py-3 transition-transform duration-180 ${
              compactSidebarRevealed ? 'pointer-events-auto translate-x-0' : 'pointer-events-none -translate-x-full'
            }`}
            onMouseDownCapture={(event) => {
              const target = event.target instanceof Element ? event.target : null
              if (event.button === 0 && !target?.closest('[data-space-menu-area="true"]')) {
                window.dispatchEvent(new Event('argent:sidebar-dismiss-menus'))
              }
            }}
            onContextMenuCapture={(event) => {
              event.preventDefault()
              clearCompactSidebarCloseTimer()
              setCompactSidebarRevealed(true)
            }}
            onPointerEnter={() => {
              clearCompactSidebarCloseTimer()
              setCompactSidebarRevealed(true)
            }}
            onPointerMove={(event) => {
              compactSidebarPointerRef.current = { x: event.clientX, y: event.clientY }
              clearCompactSidebarCloseTimer()
            }}
            onPointerLeave={() => {
              scheduleCompactSidebarClose(140)
            }}
          >
            {sidebar}
          </div>
        </div>
      ) : null}

      <CommandPalette
        spaces={state.spaces}
        activeSpaceId={state.activeSpaceId}
        compactSidebar={compactSidebar}
        onCreateTab={createTabFromPalette}
        onSelectTab={selectWorkspaceTab}
        onAddSpaceFromFolder={addSpaceFromFolder}
        onAddEmptySpace={addEmptySpace}
        onSetCompactMode={(value: boolean) => dispatch({ type: 'set-compact-sidebar', value })}
      />
    </main>
  )
}

export default App
