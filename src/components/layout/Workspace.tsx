import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppSpace, AppTab, ProviderConfig } from '../../types/opensmith'
import { TabRenderer } from '../../tabs/TabRenderer'

const HOT_TAB_LIMIT = 6
const TAB_SNOOZE_MS = 180_000
const CACHE_CLEANUP_MS = 4_000
const TITLEBAR_SHOW_Y = 72
const TITLEBAR_HIDE_Y = 96

type Props = {
  space: AppSpace
  activeTab: AppTab | null
  providers: ProviderConfig[]
  onUpdateTab: (tab: AppTab) => void
  onOpenEditorFileInNewTab: (spaceId: string, afterTabId: string, filePath: string, content: string) => void
  onSendAI: (
    providerId: string,
    messages: { role: 'user' | 'assistant'; content: string }[],
    cwd?: string,
    model?: string,
  ) => Promise<string>
}

function RenderPanel({
  spaceId,
  spaceKind,
  tab,
  isActive,
  cwd,
  providers,
  onUpdateTab,
  onOpenEditorFileInNewTab,
  onSendAI,
}: {
  spaceId: string
  spaceKind: 'project' | 'global'
  tab: AppTab
  isActive: boolean
  cwd: string
  providers: ProviderConfig[]
  onUpdateTab: (tab: AppTab) => void
  onOpenEditorFileInNewTab: (spaceId: string, afterTabId: string, filePath: string, content: string) => void
  onSendAI: (
    providerId: string,
    messages: { role: 'user' | 'assistant'; content: string }[],
    cwd?: string,
    model?: string,
  ) => Promise<string>
}) {
  return (
    <TabRenderer
      tab={tab}
      isActive={isActive}
      spaceId={spaceId}
      spaceKind={spaceKind}
      cwd={cwd}
      providers={providers}
      updateTab={onUpdateTab}
      openEditorFileInNewTab={onOpenEditorFileInNewTab}
      sendAI={onSendAI}
    />
  )
}

export function Workspace({
  space,
  activeTab,
  providers,
  onUpdateTab,
  onOpenEditorFileInNewTab,
  onSendAI,
}: Props) {
  const [titlebarVisible, setTitlebarVisible] = useState(false)
  const [hotTabIds, setHotTabIds] = useState<string[]>(activeTab ? [activeTab.id] : [])
  const titlebarVisibleRef = useRef(false)
  const tabLastSeenRef = useRef<Record<string, number>>({})

  const currentTab = activeTab
  const isBrowserTab = currentTab?.type === 'browser'

  const shouldKeepTabMounted = useCallback((tab: AppTab) => {
    if (tab.type === 'ai') {
      return Boolean(tab.isGenerating)
    }
    if (tab.type === 'terminal') {
      return Boolean(tab.sessionId)
    }
    return false
  }, [])

  const pruneHotTabs = useCallback((source: string[], now: number): string[] => {
    if (!currentTab) {
      return []
    }

    const openTabIds = new Set(space.tabs.map((tab) => tab.id))

    const filtered = source.filter((id) => openTabIds.has(id))
    const activeId = currentTab.id
    if (!filtered.includes(activeId)) {
      filtered.push(activeId)
    }

    for (const tab of space.tabs) {
      if (shouldKeepTabMounted(tab) && !filtered.includes(tab.id)) {
        filtered.push(tab.id)
      }
    }

    const snoozed = filtered.filter((id) => {
      if (id === activeId) {
        return true
      }

      const tab = space.tabs.find((item) => item.id === id)
      if (tab && shouldKeepTabMounted(tab)) {
        return true
      }

      const lastSeen = tabLastSeenRef.current[id] ?? 0
      return now - lastSeen <= TAB_SNOOZE_MS
    })

    while (snoozed.length > HOT_TAB_LIMIT) {
      const candidates = snoozed.filter((id) => {
        if (id === activeId) {
          return false
        }

        const tab = space.tabs.find((item) => item.id === id)
        return !tab || !shouldKeepTabMounted(tab)
      })
      if (candidates.length === 0) {
        break
      }

      const nonTerminalCandidates = candidates.filter((id) => {
        const tab = space.tabs.find((item) => item.id === id)
        return tab?.type !== 'terminal'
      })

      const candidatePool = nonTerminalCandidates.length > 0 ? nonTerminalCandidates : candidates

      const oldestId = candidatePool.reduce((oldest, id) => {
        const oldestSeen = tabLastSeenRef.current[oldest] ?? Number.POSITIVE_INFINITY
        const seen = tabLastSeenRef.current[id] ?? Number.POSITIVE_INFINITY
        return seen < oldestSeen ? id : oldest
      }, candidatePool[0])

      const index = snoozed.indexOf(oldestId)
      if (index >= 0) {
        snoozed.splice(index, 1)
      }
    }

    return snoozed
  }, [currentTab, shouldKeepTabMounted, space.tabs])

  useEffect(() => {
    if (!currentTab) {
      const frame = window.requestAnimationFrame(() => {
        setHotTabIds((current) => (current.length === 0 ? current : []))
      })
      return () => window.cancelAnimationFrame(frame)
    }

    const now = Date.now()
    tabLastSeenRef.current[currentTab.id] = now
    const frame = window.requestAnimationFrame(() => {
      setHotTabIds((current) => pruneHotTabs(current, now))
    })
    return () => window.cancelAnimationFrame(frame)
  }, [currentTab, pruneHotTabs])

  useEffect(() => {
    if (!currentTab) {
      return
    }

    const now = Date.now()
    tabLastSeenRef.current = { [currentTab.id]: now }
    const pinnedTabIds = space.tabs.filter((tab) => shouldKeepTabMounted(tab)).map((tab) => tab.id)
    const frame = window.requestAnimationFrame(() => {
      setHotTabIds(() => Array.from(new Set([currentTab.id, ...pinnedTabIds])))
    })
    return () => window.cancelAnimationFrame(frame)
  }, [currentTab, shouldKeepTabMounted, space.id, space.tabs])

  useEffect(() => {
    if (!currentTab) {
      return
    }

    const intervalId = window.setInterval(() => {
      setHotTabIds((current) => pruneHotTabs(current, Date.now()))
    }, CACHE_CLEANUP_MS)

    return () => window.clearInterval(intervalId)
  }, [currentTab, pruneHotTabs])

  useEffect(() => {
    if (!currentTab) {
      return
    }

    const setTitlebar = (nextVisible: boolean) => {
      if (titlebarVisibleRef.current === nextVisible) {
        return
      }
      titlebarVisibleRef.current = nextVisible
      setTitlebarVisible(nextVisible)
    }

    if (currentTab.type === 'browser') {
      setTitlebar(true)
      return
    }

    const onMouseMove = (event: MouseEvent) => {
      if (event.clientY <= TITLEBAR_SHOW_Y) {
        setTitlebar(true)
        return
      }
      if (event.clientY >= TITLEBAR_HIDE_Y) {
        setTitlebar(false)
      }
    }

    const onMouseLeave = () => setTitlebar(false)

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseleave', onMouseLeave)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseleave', onMouseLeave)
    }
  }, [currentTab])

  useEffect(() => {
    titlebarVisibleRef.current = titlebarVisible
    void window.opensmith.window.setNativeControlsVisible(titlebarVisible)
  }, [titlebarVisible])

  useEffect(() => {
    return () => {
      void window.opensmith.window.setNativeControlsVisible(false)
    }
  }, [])

  if (!currentTab) {
    return null
  }

  const hotTabs = hotTabIds
    .map((id) => space.tabs.find((tab) => tab.id === id))
    .filter((tab): tab is AppTab => Boolean(tab))

  return (
    <section className={`workspace glass-panel ${titlebarVisible ? 'is-titlebar-visible' : ''} ${isBrowserTab ? 'is-browser-tab' : ''}`}>
      <div className="workspace-titlebar" />
      <div className="workspace-content">
        <div className={`workspace-body ${isBrowserTab ? 'bg-transparent backdrop-blur-none' : ''}`}>
          <div className="relative h-full min-h-0">
            {hotTabs.map((tab) => {
              const isActive = tab.id === currentTab.id
              return (
                <div
                  key={tab.id}
                  className={isActive ? 'h-full min-h-0' : 'absolute inset-0 opacity-0 pointer-events-none'}
                  aria-hidden={!isActive}
                >
                  <RenderPanel
                    spaceId={space.id}
                    spaceKind={space.kind ?? 'project'}
                    tab={tab}
                    isActive={isActive}
                    cwd={space.rootPath}
                    providers={providers}
                    onUpdateTab={onUpdateTab}
                    onOpenEditorFileInNewTab={onOpenEditorFileInNewTab}
                    onSendAI={onSendAI}
                  />
                </div>
              )
            })}
          </div>
        </div>
      </div>
      <div className="workspace-titlebar-zone" />
    </section>
  )
}
