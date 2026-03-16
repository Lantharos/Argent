import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { AppSpace, AppTab, AppTabGroup, AppTabSplitNode, ProviderConfig } from '../../types/opensmith'
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
  onSelectWorkspaceTab: (spaceId: string, tabId: string) => void
  onSplitTab: (spaceId: string, sourceTabId: string, targetTabId: string, direction: 'left' | 'right' | 'top' | 'bottom') => void
  onSetSplitRatio: (spaceId: string, branchId: string, ratio: number) => void
  onSendAI: (
    providerId: string,
    messages: { role: 'user' | 'assistant'; content: string }[],
    cwd?: string,
    model?: string,
  ) => Promise<string>
}

type SplitDirection = 'left' | 'right' | 'top' | 'bottom'

type DragTabPayload = {
  spaceId: string
  tabId: string
}

type DropPreview = {
  targetTabId: string
  direction: SplitDirection
}

type LeafBounds = {
  tabId: string
  left: number
  top: number
  right: number
  bottom: number
}

const TAB_DRAG_MIME = 'application/x-opensmith-tab'
const TAB_DRAG_FALLBACK_PREFIX = 'opensmith-tab:'

function areSameIds(a: string[], b: string[]) {
  if (a.length !== b.length) {
    return false
  }

  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false
    }
  }

  return true
}

function readDragPayload(dataTransfer: DataTransfer | null): DragTabPayload | null {
  if (!dataTransfer) {
    return null
  }

  const raw = dataTransfer.getData(TAB_DRAG_MIME)
  const fallbackRaw = dataTransfer.getData('text/plain')
  const candidate = raw || fallbackRaw
  if (!candidate) {
    return null
  }

  if (candidate.startsWith(TAB_DRAG_FALLBACK_PREFIX)) {
    const [, spaceId, tabId] = candidate.split(':')
    if (!spaceId || !tabId) {
      return null
    }
    return { spaceId, tabId }
  }

  try {
    const payload = JSON.parse(candidate) as DragTabPayload
    if (!payload?.spaceId || !payload?.tabId) {
      return null
    }
    return payload
  } catch {
    return null
  }
}

function collectGroupTabIds(node: AppTabSplitNode, out: string[]) {
  if (node.type === 'leaf') {
    out.push(node.tabId)
    return
  }

  collectGroupTabIds(node.first, out)
  collectGroupTabIds(node.second, out)
}

function findGroupByTab(groups: AppTabGroup[] | undefined, tabId: string | null): AppTabGroup | null {
  if (!groups || !tabId) {
    return null
  }

  return (
    groups.find((group) => {
      const ids: string[] = []
      collectGroupTabIds(group.root, ids)
      return ids.includes(tabId)
    }) ?? null
  )
}

function resolveDropDirection(clientX: number, clientY: number, rect: DOMRect): SplitDirection | null {
  const xRatio = (clientX - rect.left) / Math.max(1, rect.width)
  const yRatio = (clientY - rect.top) / Math.max(1, rect.height)

  const left = xRatio
  const right = 1 - xRatio
  const top = yRatio
  const bottom = 1 - yRatio
  const scores: Array<{ direction: SplitDirection; score: number }> = [
    { direction: 'left', score: left },
    { direction: 'right', score: right },
    { direction: 'top', score: top },
    { direction: 'bottom', score: bottom },
  ]

  scores.sort((a, b) => a.score - b.score)
  const candidate = scores[0]
  if (!candidate) {
    return null
  }
  return candidate.direction
}

function collectLeafBounds(node: AppTabSplitNode, left: number, top: number, width: number, height: number, out: LeafBounds[]) {
  if (node.type === 'leaf') {
    out.push({
      tabId: node.tabId,
      left,
      top,
      right: left + width,
      bottom: top + height,
    })
    return
  }

  if (node.orientation === 'vertical') {
    collectLeafBounds(node.first, left, top, width * 0.5, height, out)
    collectLeafBounds(node.second, left + width * 0.5, top, width * 0.5, height, out)
    return
  }

  collectLeafBounds(node.first, left, top, width, height * 0.5, out)
  collectLeafBounds(node.second, left, top + height * 0.5, width, height * 0.5, out)
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
  onSelectWorkspaceTab,
  onSplitTab,
  onSetSplitRatio,
  onSendAI,
}: Props) {
  const [titlebarVisible, setTitlebarVisible] = useState(false)
  const [hotTabIds, setHotTabIds] = useState<string[]>(activeTab ? [activeTab.id] : [])
  const [dropPreview, setDropPreview] = useState<DropPreview | null>(null)
  const [sidebarDragPayload, setSidebarDragPayload] = useState<DragTabPayload | null>(null)
  const [splitRatios, setSplitRatios] = useState<Record<string, number>>({})
  const titlebarVisibleRef = useRef(false)
  const tabLastSeenRef = useRef<Record<string, number>>({})
  const splitLayerRef = useRef<HTMLDivElement | null>(null)
  const splitRatiosRef = useRef<Record<string, number>>({})
  const resizeStateRef = useRef<
    | {
        branchId: string
        orientation: 'vertical' | 'horizontal'
        startClientX: number
        startClientY: number
        startRatio: number
        width: number
        height: number
      }
    | null
  >(null)

  const currentTab = activeTab
  const activeGroup = useMemo(() => findGroupByTab(space.tabGroups, currentTab?.id ?? null), [currentTab?.id, space.tabGroups])
  const visibleTabIds = useMemo(() => {
    if (!currentTab) {
      return []
    }

    if (!activeGroup) {
      return [currentTab.id]
    }

    const ids: string[] = []
    collectGroupTabIds(activeGroup.root, ids)
    return ids
  }, [activeGroup, currentTab])
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
    for (const visibleId of visibleTabIds) {
      if (!filtered.includes(visibleId)) {
        filtered.push(visibleId)
      }
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
  }, [currentTab, shouldKeepTabMounted, space.tabs, visibleTabIds])

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
      setHotTabIds((current) => {
        const next = pruneHotTabs(current, now)
        return areSameIds(current, next) ? current : next
      })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [currentTab, pruneHotTabs])

  useEffect(() => {
    if (!currentTab) {
      return
    }

    const now = Date.now()
    tabLastSeenRef.current = { [currentTab.id]: now }
    const pinnedTabIds = space.tabs.filter((tab) => shouldKeepTabMounted(tab) || visibleTabIds.includes(tab.id)).map((tab) => tab.id)
    const frame = window.requestAnimationFrame(() => {
      const next = Array.from(new Set([currentTab.id, ...pinnedTabIds]))
      setHotTabIds((current) => (areSameIds(current, next) ? current : next))
    })
    return () => window.cancelAnimationFrame(frame)
  }, [currentTab, shouldKeepTabMounted, space.id, space.tabs, visibleTabIds])

  useEffect(() => {
    if (!currentTab) {
      return
    }

    const intervalId = window.setInterval(() => {
      setHotTabIds((current) => {
        const next = pruneHotTabs(current, Date.now())
        return areSameIds(current, next) ? current : next
      })
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

  useEffect(() => {
    const clearPreview = () => setDropPreview(null)
    window.addEventListener('dragend', clearPreview)
    window.addEventListener('drop', clearPreview)
    return () => {
      window.removeEventListener('dragend', clearPreview)
      window.removeEventListener('drop', clearPreview)
    }
  }, [])

  useEffect(() => {
    const onDragStart = (event: Event) => {
      const payload = (event as CustomEvent<DragTabPayload>).detail
      if (!payload?.spaceId || !payload?.tabId) {
        return
      }
      setSidebarDragPayload(payload)
    }

    const onDragEnd = () => {
      setSidebarDragPayload(null)
      setDropPreview(null)
    }

    window.addEventListener('opensmith:tab-drag-start', onDragStart as EventListener)
    window.addEventListener('opensmith:tab-drag-end', onDragEnd)
    window.addEventListener('dragend', onDragEnd)
    window.addEventListener('drop', onDragEnd)

    return () => {
      window.removeEventListener('opensmith:tab-drag-start', onDragStart as EventListener)
      window.removeEventListener('opensmith:tab-drag-end', onDragEnd)
      window.removeEventListener('dragend', onDragEnd)
      window.removeEventListener('drop', onDragEnd)
    }
  }, [])

  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      const resizeState = resizeStateRef.current
      if (!resizeState) {
        return
      }

      const delta =
        resizeState.orientation === 'vertical'
          ? (event.clientX - resizeState.startClientX) / resizeState.width
          : (event.clientY - resizeState.startClientY) / resizeState.height
      const nextRatio = Math.max(0.16, Math.min(0.84, resizeState.startRatio + delta))
      setSplitRatios((current) => {
        if (Math.abs((current[resizeState.branchId] ?? 0.5) - nextRatio) < 0.001) {
          return current
        }
        const next = {
          ...current,
          [resizeState.branchId]: nextRatio,
        }
        splitRatiosRef.current = next
        return next
      })
    }

    const onMouseUp = () => {
      const resizeState = resizeStateRef.current
      if (resizeState) {
        const ratio = splitRatiosRef.current[resizeState.branchId]
        if (typeof ratio === 'number') {
          onSetSplitRatio(space.id, resizeState.branchId, ratio)
        }
      }
      resizeStateRef.current = null
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [onSetSplitRatio, space.id])

  if (!currentTab) {
    return null
  }

  const hotTabs = hotTabIds.map((id) => space.tabs.find((tab) => tab.id === id)).filter((tab): tab is AppTab => Boolean(tab))
  const hotTabsById = new Map(hotTabs.map((tab) => [tab.id, tab]))
  const hasSplitLayout = Boolean(activeGroup)
  const isDragSplitting = Boolean(sidebarDragPayload && sidebarDragPayload.spaceId === space.id)

  function getSplitRatio(branchId: string, fallback: number) {
    return splitRatios[branchId] ?? fallback
  }

  function startResizeSplit(event: React.MouseEvent<HTMLDivElement>, branchId: string, orientation: 'vertical' | 'horizontal', currentRatio: number) {
    event.preventDefault()
    event.stopPropagation()

    const container = event.currentTarget.parentElement
    if (!container) {
      return
    }

    const rect = container.getBoundingClientRect()
    resizeStateRef.current = {
      branchId,
      orientation,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startRatio: currentRatio,
      width: Math.max(1, rect.width),
      height: Math.max(1, rect.height),
    }
  }

  function getCurrentDragPayload(dataTransfer: DataTransfer | null): DragTabPayload | null {
    return readDragPayload(dataTransfer) ?? sidebarDragPayload
  }

  function onLeafDragOver(event: React.DragEvent<HTMLDivElement>, targetTabId: string) {
    const payload = getCurrentDragPayload(event.dataTransfer)
    if (!payload || payload.spaceId !== space.id || payload.tabId === targetTabId) {
      setDropPreview(null)
      return
    }

    const target = event.currentTarget
    const rect = target.getBoundingClientRect()
    const direction = resolveDropDirection(event.clientX, event.clientY, rect)
    if (!direction) {
      setDropPreview(null)
      return
    }

    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDropPreview({
      targetTabId,
      direction,
    })
  }

  function onLeafDrop(event: React.DragEvent<HTMLDivElement>, targetTabId: string) {
    const payload = getCurrentDragPayload(event.dataTransfer)
    const preview = dropPreview
    setDropPreview(null)

    if (!payload || !preview || payload.spaceId !== space.id || payload.tabId === targetTabId) {
      return
    }

    event.preventDefault()
    onSplitTab(space.id, payload.tabId, targetTabId, preview.direction)
  }

  function onLeafDragLeave(event: React.DragEvent<HTMLDivElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return
    }
    setDropPreview((current) => {
      if (!current) {
        return null
      }
      return null
    })
  }

  function onLeafZoneDragOver(targetTabId: string, direction: SplitDirection, event: React.DragEvent<HTMLDivElement>) {
    const payload = getCurrentDragPayload(event.dataTransfer)
    if (!payload || payload.spaceId !== space.id || payload.tabId === targetTabId) {
      setDropPreview(null)
      return
    }

    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDropPreview({ targetTabId, direction })
  }

  function onLeafZoneDrop(targetTabId: string, direction: SplitDirection, event: React.DragEvent<HTMLDivElement>) {
    const payload = getCurrentDragPayload(event.dataTransfer)
    setDropPreview(null)
    if (!payload || payload.spaceId !== space.id || payload.tabId === targetTabId) {
      return
    }

    event.preventDefault()
    onSplitTab(space.id, payload.tabId, targetTabId, direction)
    setSidebarDragPayload(null)
  }

  function resolveOverlayTargetTabId(direction: SplitDirection): string {
    const fallbackTabId = currentTab?.id ?? space.activeTabId ?? space.tabs[0]?.id ?? ''
    if (!activeGroup) {
      return fallbackTabId
    }

    const leaves: LeafBounds[] = []
    collectLeafBounds(activeGroup.root, 0, 0, 1, 1, leaves)
    if (leaves.length === 0) {
      return fallbackTabId
    }

    const edge = leaves.reduce((best, leaf) => {
      if (direction === 'left') {
        return leaf.left < best.left ? leaf : best
      }
      if (direction === 'right') {
        return leaf.right > best.right ? leaf : best
      }
      if (direction === 'top') {
        return leaf.top < best.top ? leaf : best
      }
      return leaf.bottom > best.bottom ? leaf : best
    }, leaves[0])

    return edge.tabId
  }

  function onOverlayDragOver(direction: SplitDirection, event: React.DragEvent<HTMLDivElement>) {
    const payload = getCurrentDragPayload(event.dataTransfer)
    if (!payload || payload.spaceId !== space.id) {
      return
    }

    const targetTabId = resolveOverlayTargetTabId(direction)
    if (!targetTabId) {
      setDropPreview(null)
      return
    }
    if (payload.tabId === targetTabId) {
      setDropPreview(null)
      return
    }

    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDropPreview({ targetTabId, direction })
  }

  function onOverlayDragLeave(event: React.DragEvent<HTMLDivElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return
    }
    setDropPreview(null)
  }

  function onOverlayDrop(direction: SplitDirection, event: React.DragEvent<HTMLDivElement>) {
    const payload = getCurrentDragPayload(event.dataTransfer)
    const targetTabId = resolveOverlayTargetTabId(direction)
    setDropPreview(null)
    if (!payload || !targetTabId || payload.spaceId !== space.id || payload.tabId === targetTabId) {
      return
    }
    event.preventDefault()
    onSplitTab(space.id, payload.tabId, targetTabId, direction)
    setSidebarDragPayload(null)
  }

  function renderLeaf(tabId: string, splitMode: boolean) {
    const tab = hotTabsById.get(tabId) ?? space.tabs.find((item) => item.id === tabId)
    if (!tab) {
      return null
    }

    const isActive = currentTab?.id === tab.id
    return (
      <div
        data-opensmith-preview-tab-id={tab.id}
        className={`split-pane-leaf ${splitMode ? 'is-split-mode' : 'is-plain-mode'} ${isActive ? 'is-active' : ''}`}
        onMouseDown={() => {
          if (space.activeTabId !== tab.id) {
            onSelectWorkspaceTab(space.id, tab.id)
          }
        }}
        onClick={() => {
          if (space.activeTabId !== tab.id) {
            onSelectWorkspaceTab(space.id, tab.id)
          }
        }}
        onDragOver={(event) => {
          if (!splitMode) {
            onLeafDragOver(event, tab.id)
          }
        }}
        onDrop={(event) => {
          if (!splitMode) {
            onLeafDrop(event, tab.id)
          }
        }}
        onDragLeave={(event) => {
          if (!splitMode) {
            onLeafDragLeave(event)
          }
        }}
      >
        {splitMode && isDragSplitting ? (
          <div className="split-leaf-drag-overlay" aria-hidden="true">
            <div
              className={`split-leaf-drag-zone split-leaf-drag-zone-left ${dropPreview?.targetTabId === tab.id && dropPreview?.direction === 'left' ? 'is-active' : ''}`}
              onDragOver={(event) => onLeafZoneDragOver(tab.id, 'left', event)}
              onDragLeave={onOverlayDragLeave}
              onDrop={(event) => onLeafZoneDrop(tab.id, 'left', event)}
            />
            <div
              className={`split-leaf-drag-zone split-leaf-drag-zone-right ${dropPreview?.targetTabId === tab.id && dropPreview?.direction === 'right' ? 'is-active' : ''}`}
              onDragOver={(event) => onLeafZoneDragOver(tab.id, 'right', event)}
              onDragLeave={onOverlayDragLeave}
              onDrop={(event) => onLeafZoneDrop(tab.id, 'right', event)}
            />
            <div
              className={`split-leaf-drag-zone split-leaf-drag-zone-top ${dropPreview?.targetTabId === tab.id && dropPreview?.direction === 'top' ? 'is-active' : ''}`}
              onDragOver={(event) => onLeafZoneDragOver(tab.id, 'top', event)}
              onDragLeave={onOverlayDragLeave}
              onDrop={(event) => onLeafZoneDrop(tab.id, 'top', event)}
            />
            <div
              className={`split-leaf-drag-zone split-leaf-drag-zone-bottom ${dropPreview?.targetTabId === tab.id && dropPreview?.direction === 'bottom' ? 'is-active' : ''}`}
              onDragOver={(event) => onLeafZoneDragOver(tab.id, 'bottom', event)}
              onDragLeave={onOverlayDragLeave}
              onDrop={(event) => onLeafZoneDrop(tab.id, 'bottom', event)}
            />
          </div>
        ) : null}
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
  }

  function renderSplitNode(node: AppTabSplitNode): ReactNode {
    if (node.type === 'leaf') {
      return renderLeaf(node.tabId, true)
    }

    const ratio = getSplitRatio(node.id, node.ratio ?? 0.5)

    return (
      <div className={`split-node ${node.orientation === 'vertical' ? 'split-node-vertical' : 'split-node-horizontal'}`}>
        <div className="split-node-child" style={{ flex: `${ratio} 1 0%` }}>{renderSplitNode(node.first)}</div>
        <div
          className={`split-node-divider ${node.orientation === 'vertical' ? 'split-node-divider-vertical' : 'split-node-divider-horizontal'}`}
          onMouseDown={(event) => startResizeSplit(event, node.id, node.orientation, ratio)}
        />
        <div className="split-node-child" style={{ flex: `${1 - ratio} 1 0%` }}>{renderSplitNode(node.second)}</div>
      </div>
    )
  }

  const activeZoneDirection = dropPreview?.direction ?? null

  return (
    <section className={`workspace glass-panel ${titlebarVisible ? 'is-titlebar-visible' : ''} ${isBrowserTab ? 'is-browser-tab' : ''}`}>
      <div className="workspace-titlebar" />
      <div className="workspace-content">
        <div className={`workspace-body ${hasSplitLayout ? 'is-split-layout' : ''} ${isBrowserTab ? 'bg-transparent backdrop-blur-none' : ''}`}>
          {hasSplitLayout ? (
            <div
              ref={splitLayerRef}
              className="workspace-split-layer is-split-mode"
              onDragOver={(event) => {
                const payload = getCurrentDragPayload(event.dataTransfer)
                if (payload && payload.spaceId === space.id) {
                  event.preventDefault()
                }
              }}
              onDrop={() => setDropPreview(null)}
            >
              {activeGroup ? renderSplitNode(activeGroup.root) : null}
            </div>
          ) : (
            <div
              ref={splitLayerRef}
              className="workspace-split-layer is-plain-mode"
              onDragOver={(event) => {
                const payload = getCurrentDragPayload(event.dataTransfer)
                if (payload && payload.spaceId === space.id) {
                  event.preventDefault()
                }
              }}
              onDrop={() => setDropPreview(null)}
            >
              {hotTabs.map((tab) => {
                const isActive = tab.id === currentTab.id
                return (
                  <div
                    key={tab.id}
                    className={isActive ? 'h-full min-h-0' : 'absolute inset-0 opacity-0 pointer-events-none'}
                    aria-hidden={!isActive}
                  >
                    {renderLeaf(tab.id, false)}
                  </div>
                )
              })}
              {isDragSplitting ? (
                <div className="split-drag-overlay" aria-hidden="true">
                  <div
                    className={`split-drag-zone split-drag-zone-left ${activeZoneDirection === 'left' ? 'is-active' : ''}`}
                    onDragOver={(event) => onOverlayDragOver('left', event)}
                    onDragLeave={onOverlayDragLeave}
                    onDrop={(event) => onOverlayDrop('left', event)}
                  />
                  <div
                    className={`split-drag-zone split-drag-zone-right ${activeZoneDirection === 'right' ? 'is-active' : ''}`}
                    onDragOver={(event) => onOverlayDragOver('right', event)}
                    onDragLeave={onOverlayDragLeave}
                    onDrop={(event) => onOverlayDrop('right', event)}
                  />
                  <div
                    className={`split-drag-zone split-drag-zone-top ${activeZoneDirection === 'top' ? 'is-active' : ''}`}
                    onDragOver={(event) => onOverlayDragOver('top', event)}
                    onDragLeave={onOverlayDragLeave}
                    onDrop={(event) => onOverlayDrop('top', event)}
                  />
                  <div
                    className={`split-drag-zone split-drag-zone-bottom ${activeZoneDirection === 'bottom' ? 'is-active' : ''}`}
                    onDragOver={(event) => onOverlayDragOver('bottom', event)}
                    onDragLeave={onOverlayDragLeave}
                    onDrop={(event) => onOverlayDrop('bottom', event)}
                  />
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
      <div className="workspace-titlebar-zone" />
    </section>
  )
}

