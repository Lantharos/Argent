import { useEffect, useMemo, useReducer, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { AppSnapshot, AppTab, AppTabType, PromptAttachment, ProviderConfig } from './types/opensmith'
import { appReducer } from './state/reducer'
import { defaultSnapshot, createGlobalSpace, createSpace } from './state/snapshot'
import { getActiveSpace, getTab } from './state/selectors'
import { createTab } from './state/tabFactory'
import { CommandPalette } from './components/layout/CommandPalette'
import { EmptyState } from './components/layout/EmptyState'
import { SpaceSidebar } from './components/layout/SpaceSidebar'
import { Workspace } from './components/layout/Workspace'
import './App.css'

function App() {
  const [state, dispatch] = useReducer(appReducer, defaultSnapshot())
  const [loaded, setLoaded] = useState(false)
  const [bridgeReady, setBridgeReady] = useState(true)
  const [providers, setProviders] = useState<ProviderConfig[]>([])
  const [homeDirectory, setHomeDirectory] = useState('')

  const activeSpace = useMemo(() => getActiveSpace(state), [state])
  const activeTab = useMemo(() => getTab(activeSpace, activeSpace?.activeTabId ?? null), [activeSpace])

  useEffect(() => {
    async function boot() {
      if (!window.opensmith?.app) {
        setBridgeReady(false)
        setLoaded(true)
        return
      }

      const [snapshot, providerList, homePath] = await Promise.all([
        window.opensmith.app.loadState(),
        window.opensmith.providers.list(),
        window.opensmith.app.getHomeDirectory(),
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
      void window.opensmith.app.saveState(state)
    }, 180)

    return () => clearTimeout(id)
  }, [loaded, state])

  async function addSpaceFromFolder() {
    const folder = await window.opensmith.app.chooseFolder()
    if (!folder) {
      return false
    }

    const space = createSpace(folder)
    dispatch({ type: 'add-space', space })
    return true
  }

  async function addEmptySpace() {
    const fallbackHome = await window.opensmith.app.getHomeDirectory()
    const space = createGlobalSpace(homeDirectory || fallbackHome)
    dispatch({ type: 'add-space', space })
    return true
  }

  function isAuthCloneError(text: string) {
    return /authentication failed|could not read username|terminal prompts disabled|password authentication|access denied|permission denied.*(github|gitlab|bitbucket)|invalid username or password/i.test(text)
  }

  async function cloneRepoToSpace(repoUrl: string, selectedParentDir?: string) {
    const parentDir = selectedParentDir || await window.opensmith.app.chooseFolder()
    if (!parentDir) {
      return { success: false, error: 'Select a destination folder to clone into.', parentDir: null, authRequired: false }
    }

    const result = await window.opensmith.git.clone({ repoUrl, parentDir })
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

  function openEditorFileInNewTab(spaceId: string, afterTabId: string, filePath: string, content: string) {
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
    const reply = await window.opensmith.ai.sendMessage({ providerId, messages, cwd, model, attachments })
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
          It seems like the OpenSmith bridge is not available. Please make sure you are running this app within the OpenSmith environment.
        </p>
      </div>
    )
  }

  return (
    <main className="app-shell">
      <SpaceSidebar
        spaces={state.spaces}
        activeSpaceId={state.activeSpaceId}
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
          return window.opensmith.app.openInExplorer(target.rootPath)
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

      <CommandPalette
        spaces={state.spaces}
        activeSpaceId={state.activeSpaceId}
        onCreateTab={createTabFromPalette}
        onSelectTab={selectWorkspaceTab}
        onAddSpaceFromFolder={addSpaceFromFolder}
        onAddEmptySpace={addEmptySpace}
      />
    </main>
  )
}

export default App
