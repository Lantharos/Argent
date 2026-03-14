import { useEffect, useMemo, useReducer, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { AppSnapshot, AppTab, AppTabType, ProviderConfig } from './types/opensmith'
import { appReducer } from './state/reducer'
import { defaultSnapshot, createSpace } from './state/snapshot'
import { getActiveSpace, getTab } from './state/selectors'
import { EmptyState } from './components/layout/EmptyState'
import { SpaceSidebar } from './components/layout/SpaceSidebar'
import { Workspace } from './components/layout/Workspace'
import './App.css'

function App() {
  const [state, dispatch] = useReducer(appReducer, defaultSnapshot())
  const [loaded, setLoaded] = useState(false)
  const [bridgeReady, setBridgeReady] = useState(true)
  const [providers, setProviders] = useState<ProviderConfig[]>([])

  const activeSpace = useMemo(() => getActiveSpace(state), [state])
  const activeTab = useMemo(() => getTab(activeSpace, activeSpace?.activeTabId ?? null), [activeSpace])

  useEffect(() => {
    async function boot() {
      if (!window.opensmith?.app) {
        setBridgeReady(false)
        setLoaded(true)
        return
      }

      const [snapshot, providerList] = await Promise.all([window.opensmith.app.loadState(), window.opensmith.providers.list()])
      dispatch({ type: 'replace', value: snapshot as AppSnapshot })
      setProviders(providerList)
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

  async function createSpaceFromFolder() {
    const folder = await window.opensmith.app.chooseFolder()
    if (!folder) {
      return
    }

    const space = createSpace(folder)
    dispatch({ type: 'add-space', space })
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

  async function sendAI(
    providerId: string,
    messages: { role: 'user' | 'assistant'; content: string }[],
    cwd?: string,
    model?: string,
  ) {
    const reply = await window.opensmith.ai.sendMessage({ providerId, messages, cwd, model })
    return reply.content
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
        activeSpace={activeSpace}
        onActivateSpace={(spaceId) => dispatch({ type: 'set-active-space', spaceId })}
        onAddSpace={createSpaceFromFolder}
        onAddTab={(spaceId: string, tabType: AppTabType) => {
          dispatch({ type: 'add-tab', spaceId, tabType })
          dispatch({ type: 'set-active-space', spaceId })
        }}
        onSelectTab={(spaceId, tabId) => {
          dispatch({ type: 'set-active-space', spaceId })
          dispatch({ type: 'set-active-tab', spaceId, tabId })
        }}
        onReorderTabs={(spaceId, sourceTabId, targetTabId) => {
          dispatch({ type: 'reorder-tab', spaceId, sourceTabId, targetTabId })
        }}
        onCloseTab={(spaceId, tabId) => {
          dispatch({ type: 'close-tab', spaceId, tabId })
        }}
        onRenameTab={(spaceId, tabId, title) => {
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
          onSendAI={sendAI}
        />
      ) : (
        <div className="workspace">
          <EmptyState onCreateSpace={createSpaceFromFolder} />
        </div>
      )}
    </main>
  )
}

export default App
