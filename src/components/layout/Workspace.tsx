import { useEffect, useRef, useState } from 'react'
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
  onSendAI: (
    providerId: string,
    messages: { role: 'user' | 'assistant'; content: string }[],
    cwd?: string,
    model?: string,
  ) => Promise<string>
}

function RenderPanel({
  tab,
  isActive,
  cwd,
  providers,
  onUpdateTab,
  onSendAI,
}: {
  tab: AppTab
  isActive: boolean
  cwd: string
  providers: ProviderConfig[]
  onUpdateTab: (tab: AppTab) => void
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
      cwd={cwd}
      providers={providers}
      updateTab={onUpdateTab}
      sendAI={onSendAI}
    />
  )
}

export function Workspace({
  space,
  activeTab,
  providers,
  onUpdateTab,
  onSendAI,
}: Props) {
  const [titlebarVisible, setTitlebarVisible] = useState(false)
  const [hotTabIds, setHotTabIds] = useState<string[]>(activeTab ? [activeTab.id] : [])
  const titlebarVisibleRef = useRef(false)
  const tabLastSeenRef = useRef<Record<string, number>>({})

  if (!activeTab) {
    return null
  }

  const currentTab = activeTab
  const isBrowserTab = currentTab.type === 'browser'

  function pruneHotTabs(source: string[], now: number): string[] {
    const openTabIds = new Set(space.tabs.map((tab) => tab.id))

    const filtered = source.filter((id) => openTabIds.has(id))
    const activeId = currentTab.id
    if (!filtered.includes(activeId)) {
      filtered.push(activeId)
    }

    const snoozed = filtered.filter((id) => {
      if (id === activeId) {
        return true
      }
      const lastSeen = tabLastSeenRef.current[id] ?? 0
      return now - lastSeen <= TAB_SNOOZE_MS
    })

    while (snoozed.length > HOT_TAB_LIMIT) {
      const candidates = snoozed.filter((id) => id !== activeId)
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
  }

  useEffect(() => {
    const now = Date.now()
    tabLastSeenRef.current[currentTab.id] = now
    setHotTabIds((current) => pruneHotTabs(current, now))
  }, [currentTab.id, space.tabs])

  useEffect(() => {
    const now = Date.now()
    tabLastSeenRef.current = { [currentTab.id]: now }
    setHotTabIds([currentTab.id])
  }, [space.id])

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setHotTabIds((current) => pruneHotTabs(current, Date.now()))
    }, CACHE_CLEANUP_MS)

    return () => window.clearInterval(intervalId)
  }, [currentTab.id, space.tabs])

  useEffect(() => {
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
  }, [currentTab.type])

  useEffect(() => {
    titlebarVisibleRef.current = titlebarVisible
    void window.opensmith.window.setNativeControlsVisible(titlebarVisible)
  }, [titlebarVisible])

  useEffect(() => {
    return () => {
      void window.opensmith.window.setNativeControlsVisible(false)
    }
  }, [])

  const hotTabs = hotTabIds
    .map((id) => space.tabs.find((tab) => tab.id === id))
    .filter((tab): tab is AppTab => Boolean(tab))

  return (
    <section className={`workspace glass-panel ${titlebarVisible ? 'is-titlebar-visible' : ''}`}>
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
                    tab={tab}
                    isActive={isActive}
                    cwd={space.rootPath}
                    providers={providers}
                    onUpdateTab={onUpdateTab}
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
