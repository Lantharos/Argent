import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { AppSpace, AppTab, AppTabGroup, AppTabSplitNode, PromptAttachment, ProviderConfig } from '../../types/opensmith'
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
    attachments?: PromptAttachment[],
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

type WorkspaceSwipeDetail = {
  deltaX: number
  source?: 'browser-webview' | 'workspace'
}

type LeafBounds = {
  tabId: string
  left: number
  top: number
  right: number
  bottom: number
}

type WorkspacePage = {
  id: string
  tabIds: string[]
  primaryTabId: string
  root: AppTabSplitNode | null
}

const TAB_DRAG_MIME = 'application/x-opensmith-tab'
const TAB_DRAG_FALLBACK_PREFIX = 'opensmith-tab:'
const WORKSPACE_PAGE_SWITCH_THRESHOLD = 0.24
const WORKSPACE_PAGE_HARD_COMMIT_THRESHOLD = 0.42
const WORKSPACE_GESTURE_SETTLE_MS = 160
const WORKSPACE_GESTURE_MAX_MS = 280
const WORKSPACE_FLING_VELOCITY = 1.1
const WORKSPACE_FLING_DISTANCE_RATIO = 0.18
const WORKSPACE_GESTURE_MIN_DELTA = 1.1
const BROWSER_GESTURE_MIN_DELTA = 0.75
const BROWSER_SWIPE_EDGE_WIDTH = 28

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

function buildWorkspacePages(space: AppSpace): WorkspacePage[] {
  const groups = space.tabGroups ?? []
  if (groups.length === 0) {
    return space.tabs.map((tab) => ({
      id: `tab:${tab.id}`,
      tabIds: [tab.id],
      primaryTabId: tab.id,
      root: null,
    }))
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
  const pages: WorkspacePage[] = []

  for (const tab of space.tabs) {
    const group = groupByTab.get(tab.id)
    if (!group) {
      pages.push({
        id: `tab:${tab.id}`,
        tabIds: [tab.id],
        primaryTabId: tab.id,
        root: null,
      })
      continue
    }

    if (emittedGroups.has(group.id)) {
      continue
    }

    const ids: string[] = []
    collectGroupTabIds(group.root, ids)
    const groupedTabs = space.tabs.filter((entry) => ids.includes(entry.id))
    if (groupedTabs.length < 2) {
      for (const groupedTab of groupedTabs) {
        pages.push({
          id: `tab:${groupedTab.id}`,
          tabIds: [groupedTab.id],
          primaryTabId: groupedTab.id,
          root: null,
        })
      }
      emittedGroups.add(group.id)
      continue
    }

    pages.push({
      id: `group:${group.id}`,
      tabIds: groupedTabs.map((entry) => entry.id),
      primaryTabId: groupedTabs[0]?.id ?? tab.id,
      root: group.root,
    })
    emittedGroups.add(group.id)
  }

  return pages
}

function getPageIndexForTab(pages: WorkspacePage[], tabId: string | null): number {
  if (!tabId) {
    return 0
  }

  const index = pages.findIndex((page) => page.tabIds.includes(tabId))
  return index >= 0 ? index : 0
}

function getPreferredPageTabId(space: AppSpace, page: WorkspacePage, fallbackTabId: string | null): string {
  if (fallbackTabId && page.tabIds.includes(fallbackTabId)) {
    return fallbackTabId
  }

  const history = space.tabHistory ?? []
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const id = history[index]
    if (page.tabIds.includes(id)) {
      return id
    }
  }

  return page.primaryTabId
}

function applyGestureResistance(offset: number, min: number, max: number): number {
  if (offset < min) {
    return min + (offset - min) * 0.28
  }
  if (offset > max) {
    return max + (offset - max) * 0.28
  }
  return offset
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
    attachments?: PromptAttachment[],
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

const splitNodeBaseClass = 'h-full min-h-0 w-full'
const splitLeafBaseClass = 'relative h-full min-h-0 w-full'
const splitModeLeafClass = `${splitLeafBaseClass} overflow-hidden rounded-[12px] border border-white/8 bg-black/26 backdrop-blur-2xl transition-all`
const splitDividerBaseClass = 'shrink-0 z-20 bg-[rgba(170,170,170,0.34)] opacity-0 transition-opacity duration-140'
const splitDragOverlayClass = 'absolute inset-0 z-[90] pointer-events-none p-2'
const splitLeafDragOverlayClass = 'absolute inset-0 z-[80] pointer-events-none p-[6px]'
const splitDragZoneBaseClass = 'absolute pointer-events-auto rounded-[10px] bg-[rgba(110,176,255,0.08)] shadow-[inset_0_0_0_1px_rgba(110,176,255,0.2)] transition-[background,box-shadow] duration-120'
const splitLeafDragZoneBaseClass = 'absolute pointer-events-auto rounded-[8px] bg-[rgba(255,255,255,0.035)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)] transition-[background,box-shadow] duration-120'

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
  const [viewportWidth, setViewportWidth] = useState(0)
  const [pageGestureOffset, setPageGestureOffset] = useState(0)
  const [pageGestureActive, setPageGestureActive] = useState(false)
  const [pageAnchorIndex, setPageAnchorIndex] = useState<number | null>(null)
  const titlebarVisibleRef = useRef(false)
  const tabLastSeenRef = useRef<Record<string, number>>({})
  const splitLayerRef = useRef<HTMLDivElement | null>(null)
  const pageViewportRef = useRef<HTMLDivElement | null>(null)
  const pageTrackRef = useRef<HTMLDivElement | null>(null)
  const splitRatiosRef = useRef<Record<string, number>>({})
  const pageGestureOffsetRef = useRef(0)
  const pageGestureTimeoutRef = useRef<number | null>(null)
  const pageGestureVelocityRef = useRef(0)
  const pageGestureLastEventAtRef = useRef(0)
  const pageGestureStartedAtRef = useRef(0)
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
  const workspacePages = useMemo(() => buildWorkspacePages(space), [space])
  const currentPageIndex = useMemo(() => getPageIndexForTab(workspacePages, currentTab?.id ?? null), [currentTab?.id, workspacePages])
  const activePageIndex = pageAnchorIndex ?? currentPageIndex
  const activeGroup = useMemo(() => findGroupByTab(space.tabGroups, currentTab?.id ?? null), [currentTab?.id, space.tabGroups])
  const visibleTabIds = useMemo(() => {
    if (!currentTab || !workspacePages.length) {
      return []
    }

    const pinnedIndices = new Set([activePageIndex - 1, activePageIndex, activePageIndex + 1])
    return Array.from(pinnedIndices)
      .map((index) => workspacePages[index])
      .filter((page): page is WorkspacePage => Boolean(page))
      .flatMap((page) => page.tabIds)
  }, [activePageIndex, currentTab, workspacePages])
  const isBrowserTab = currentTab?.type === 'browser'
  const hasWorkspacePaging = workspacePages.length > 1
  const pageWidth = viewportWidth
  const pageSpan = pageWidth
  const pageTrackOffset = viewportWidth > 0 ? -activePageIndex * pageSpan + pageGestureOffset : 0
  const minGestureOffset = hasWorkspacePaging && activePageIndex < workspacePages.length - 1 ? -pageSpan : 0
  const maxGestureOffset = hasWorkspacePaging && activePageIndex > 0 ? pageSpan : 0

  useEffect(() => {
    if (pageAnchorIndex === null) {
      return
    }
    if (pageAnchorIndex === currentPageIndex) {
      setPageAnchorIndex(null)
    }
  }, [currentPageIndex, pageAnchorIndex])

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

    if (pageGestureActive) {
      setTitlebar(false)
      return
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
  }, [currentTab, pageGestureActive])

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
    const element = pageViewportRef.current
    if (!element) {
      return
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) {
        return
      }
      setViewportWidth(entry.contentRect.width)
    })
    observer.observe(element)
    setViewportWidth(element.getBoundingClientRect().width)

    return () => observer.disconnect()
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
    pageGestureOffsetRef.current = pageGestureOffset
  }, [pageGestureOffset])

  useEffect(() => {
    if (!hasWorkspacePaging && pageGestureOffsetRef.current !== 0) {
      pageGestureOffsetRef.current = 0
      setPageGestureOffset(0)
      setPageGestureActive(false)
    }
  }, [hasWorkspacePaging])

  useEffect(() => {
    return () => {
      if (pageGestureTimeoutRef.current) {
        window.clearTimeout(pageGestureTimeoutRef.current)
      }
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

  function finishPageGesture() {
    if (!hasWorkspacePaging || viewportWidth <= 0) {
      setPageGestureActive(false)
      if (pageGestureOffsetRef.current !== 0) {
        pageGestureOffsetRef.current = 0
        setPageGestureOffset(0)
      }
      return
    }

    const offset = pageGestureOffsetRef.current
    const velocity = pageGestureVelocityRef.current
    const softCommitDistance = pageSpan * WORKSPACE_PAGE_SWITCH_THRESHOLD
    const hardCommitDistance = pageSpan * WORKSPACE_PAGE_HARD_COMMIT_THRESHOLD
    const flingDistance = pageSpan * WORKSPACE_FLING_DISTANCE_RATIO
    const draggedFarEnoughLeft = offset <= -hardCommitDistance
    const draggedFarEnoughRight = offset >= hardCommitDistance
    const flungLeft = offset <= -softCommitDistance && offset <= -flingDistance && velocity >= WORKSPACE_FLING_VELOCITY
    const flungRight = offset >= softCommitDistance && offset >= flingDistance && velocity <= -WORKSPACE_FLING_VELOCITY
    let targetIndex = activePageIndex
    if (
      (draggedFarEnoughLeft || flungLeft)
      && activePageIndex < workspacePages.length - 1
    ) {
      targetIndex = activePageIndex + 1
    } else if (
      (draggedFarEnoughRight || flungRight)
      && activePageIndex > 0
    ) {
      targetIndex = activePageIndex - 1
    }

    if (targetIndex !== activePageIndex) {
      const targetPage = workspacePages[targetIndex]
      const nextTabId = targetPage ? getPreferredPageTabId(space, targetPage, currentTab?.id ?? null) : null
      if (nextTabId) {
        setPageAnchorIndex(targetIndex)
        onSelectWorkspaceTab(space.id, nextTabId)
      }
    }

    pageGestureOffsetRef.current = 0
    pageGestureVelocityRef.current = 0
    pageGestureLastEventAtRef.current = 0
    pageGestureStartedAtRef.current = 0
    setPageGestureOffset(0)
    setPageGestureActive(false)
  }

  function schedulePageGestureFinish(delay = WORKSPACE_GESTURE_SETTLE_MS) {
    if (pageGestureTimeoutRef.current) {
      window.clearTimeout(pageGestureTimeoutRef.current)
    }

    pageGestureTimeoutRef.current = window.setTimeout(() => {
      finishPageGesture()
    }, delay)
  }

  function syncGestureOffsetToRenderedTrack() {
    const track = pageTrackRef.current
    if (!track || viewportWidth <= 0) {
      return
    }

    const computedTransform = window.getComputedStyle(track).transform
    if (!computedTransform || computedTransform === 'none') {
      return
    }

    const matrix = new DOMMatrixReadOnly(computedTransform)
    const renderedTranslateX = matrix.m41
    const baseTranslateX = -activePageIndex * pageSpan
    const renderedOffset = renderedTranslateX - baseTranslateX
    pageGestureOffsetRef.current = renderedOffset
    setPageGestureOffset(renderedOffset)
  }

  function settlePageGestureOnInteraction() {
    if (!pageGestureActive && pageGestureOffsetRef.current === 0) {
      return
    }

    if (pageGestureTimeoutRef.current) {
      window.clearTimeout(pageGestureTimeoutRef.current)
      pageGestureTimeoutRef.current = null
    }

    finishPageGesture()
  }

  function applyWorkspaceSwipeDelta(deltaX: number, source: WorkspaceSwipeDetail['source'] = 'workspace') {
    if (!hasWorkspacePaging || viewportWidth <= 0) {
      return
    }

    const minDelta = source === 'browser-webview' ? BROWSER_GESTURE_MIN_DELTA : WORKSPACE_GESTURE_MIN_DELTA
    const absDelta = Math.abs(deltaX)
    if (absDelta < minDelta) {
      return
    }

    const now = performance.now()
    const elapsed = now - pageGestureLastEventAtRef.current
    pageGestureLastEventAtRef.current = now
    if (elapsed > 0 && elapsed < 220) {
      pageGestureVelocityRef.current = deltaX / elapsed
    } else {
      pageGestureVelocityRef.current = 0
    }

    if (!pageGestureActive) {
      syncGestureOffsetToRenderedTrack()
      pageGestureStartedAtRef.current = now
      setPageGestureActive(true)
    }

    const nextOffset = applyGestureResistance(pageGestureOffsetRef.current - deltaX, minGestureOffset, maxGestureOffset)
    pageGestureOffsetRef.current = nextOffset
    setPageGestureOffset(nextOffset)
    const gestureAge = pageGestureStartedAtRef.current > 0 ? now - pageGestureStartedAtRef.current : 0
    const remainingLifetime = Math.max(40, WORKSPACE_GESTURE_MAX_MS - gestureAge)
    schedulePageGestureFinish(Math.min(WORKSPACE_GESTURE_SETTLE_MS, remainingLifetime))
  }

  function onWorkspaceWheel(event: React.WheelEvent<HTMLDivElement>) {
    if (!hasWorkspacePaging || viewportWidth <= 0 || event.ctrlKey || event.metaKey) {
      return
    }

    const absX = Math.abs(event.deltaX)
    const absY = Math.abs(event.deltaY)
    const useHorizontalSwipe = absX > 0.5 && absX >= absY * 0.9
    if (!useHorizontalSwipe) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    applyWorkspaceSwipeDelta(event.deltaX, 'workspace')
  }

  useEffect(() => {
    const onWorkspaceSwipe = (event: Event) => {
      const detail = (event as CustomEvent<WorkspaceSwipeDetail>).detail
      if (!detail || typeof detail.deltaX !== 'number') {
        return
      }
      applyWorkspaceSwipeDelta(detail.deltaX, detail.source)
    }

    window.addEventListener('opensmith:workspace-swipe', onWorkspaceSwipe)
    return () => {
      window.removeEventListener('opensmith:workspace-swipe', onWorkspaceSwipe)
    }
  }, [hasWorkspacePaging, maxGestureOffset, minGestureOffset, pageGestureActive, viewportWidth])

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
        className={
          splitMode
            ? `${splitModeLeafClass} ${isActive ? 'border-white/16' : ''}`
            : splitLeafBaseClass
        }
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
          <div className={splitLeafDragOverlayClass} aria-hidden="true">
            <div
              className={`${splitLeafDragZoneBaseClass} left-2 top-2 bottom-2 w-[18%] ${dropPreview?.targetTabId === tab.id && dropPreview?.direction === 'left' ? 'bg-[rgba(0,120,215,0.22)] shadow-[inset_0_0_0_2px_rgba(0,120,215,0.62),0_0_0_1px_rgba(0,120,215,0.24)]' : ''}`}
              onDragOver={(event) => onLeafZoneDragOver(tab.id, 'left', event)}
              onDragLeave={onOverlayDragLeave}
              onDrop={(event) => onLeafZoneDrop(tab.id, 'left', event)}
            />
            <div
              className={`${splitLeafDragZoneBaseClass} right-2 top-2 bottom-2 w-[18%] ${dropPreview?.targetTabId === tab.id && dropPreview?.direction === 'right' ? 'bg-[rgba(0,120,215,0.22)] shadow-[inset_0_0_0_2px_rgba(0,120,215,0.62),0_0_0_1px_rgba(0,120,215,0.24)]' : ''}`}
              onDragOver={(event) => onLeafZoneDragOver(tab.id, 'right', event)}
              onDragLeave={onOverlayDragLeave}
              onDrop={(event) => onLeafZoneDrop(tab.id, 'right', event)}
            />
            <div
              className={`${splitLeafDragZoneBaseClass} left-[20%] right-[20%] top-2 h-[18%] ${dropPreview?.targetTabId === tab.id && dropPreview?.direction === 'top' ? 'bg-[rgba(0,120,215,0.22)] shadow-[inset_0_0_0_2px_rgba(0,120,215,0.62),0_0_0_1px_rgba(0,120,215,0.24)]' : ''}`}
              onDragOver={(event) => onLeafZoneDragOver(tab.id, 'top', event)}
              onDragLeave={onOverlayDragLeave}
              onDrop={(event) => onLeafZoneDrop(tab.id, 'top', event)}
            />
            <div
              className={`${splitLeafDragZoneBaseClass} bottom-2 left-[20%] right-[20%] h-[18%] ${dropPreview?.targetTabId === tab.id && dropPreview?.direction === 'bottom' ? 'bg-[rgba(0,120,215,0.22)] shadow-[inset_0_0_0_2px_rgba(0,120,215,0.62),0_0_0_1px_rgba(0,120,215,0.24)]' : ''}`}
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
      <div className={`${splitNodeBaseClass} ${node.orientation === 'vertical' ? 'flex flex-row' : 'flex flex-col'}`}>
        <div className="min-h-0 min-w-0 flex-1" style={{ flex: `${ratio} 1 0%` }}>{renderSplitNode(node.first)}</div>
        <div
          className={`${splitDividerBaseClass} hover:opacity-100 active:opacity-100 ${node.orientation === 'vertical' ? 'mx-[-4px] w-2 cursor-col-resize' : 'my-[-4px] h-2 cursor-row-resize'}`}
          onMouseDown={(event) => startResizeSplit(event, node.id, node.orientation, ratio)}
        />
        <div className="min-h-0 min-w-0 flex-1" style={{ flex: `${1 - ratio} 1 0%` }}>{renderSplitNode(node.second)}</div>
      </div>
    )
  }

  function renderPage(page: WorkspacePage, index: number) {
    const isCurrentPage = index === activePageIndex
    const pageTabId = getPreferredPageTabId(space, page, isCurrentPage ? currentTab?.id ?? null : null)

    return (
      <div
        key={page.id}
        className={`relative h-full min-h-0 shrink-0 ${!isCurrentPage ? 'opacity-[0.999]' : ''}`}
        style={{ width: `${pageWidth}px` }}
        aria-hidden={!isCurrentPage}
      >
        {page.root ? (
          <div
            ref={isCurrentPage ? splitLayerRef : null}
            className="relative h-full min-h-0 w-full p-1"
            style={{ animation: 'workspace-fade-in 220ms ease' }}
            onDragOver={(event) => {
              const payload = getCurrentDragPayload(event.dataTransfer)
              if (payload && payload.spaceId === space.id) {
                event.preventDefault()
              }
            }}
            onDrop={() => setDropPreview(null)}
          >
            {renderSplitNode(page.root)}
          </div>
        ) : (
          <div
            ref={isCurrentPage ? splitLayerRef : null}
            className="relative h-full min-h-0 w-full"
            onDragOver={(event) => {
              const payload = getCurrentDragPayload(event.dataTransfer)
              if (payload && payload.spaceId === space.id) {
                event.preventDefault()
              }
            }}
            onDrop={() => setDropPreview(null)}
          >
            {renderLeaf(pageTabId, false)}
            {isCurrentPage && isDragSplitting ? (
              <div className={splitDragOverlayClass} aria-hidden="true">
                <div
                  className={`${splitDragZoneBaseClass} left-2 top-2 bottom-2 w-[24%] ${activeZoneDirection === 'left' ? 'bg-[rgba(0,120,215,0.26)] shadow-[inset_0_0_0_2px_rgba(0,120,215,0.72),0_0_0_1px_rgba(0,120,215,0.3)]' : ''}`}
                  onDragOver={(event) => onOverlayDragOver('left', event)}
                  onDragLeave={onOverlayDragLeave}
                  onDrop={(event) => onOverlayDrop('left', event)}
                />
                <div
                  className={`${splitDragZoneBaseClass} right-2 top-2 bottom-2 w-[24%] ${activeZoneDirection === 'right' ? 'bg-[rgba(0,120,215,0.26)] shadow-[inset_0_0_0_2px_rgba(0,120,215,0.72),0_0_0_1px_rgba(0,120,215,0.3)]' : ''}`}
                  onDragOver={(event) => onOverlayDragOver('right', event)}
                  onDragLeave={onOverlayDragLeave}
                  onDrop={(event) => onOverlayDrop('right', event)}
                />
                <div
                  className={`${splitDragZoneBaseClass} left-[26%] right-[26%] top-2 h-[24%] ${activeZoneDirection === 'top' ? 'bg-[rgba(0,120,215,0.26)] shadow-[inset_0_0_0_2px_rgba(0,120,215,0.72),0_0_0_1px_rgba(0,120,215,0.3)]' : ''}`}
                  onDragOver={(event) => onOverlayDragOver('top', event)}
                  onDragLeave={onOverlayDragLeave}
                  onDrop={(event) => onOverlayDrop('top', event)}
                />
                <div
                  className={`${splitDragZoneBaseClass} bottom-2 left-[26%] right-[26%] h-[24%] ${activeZoneDirection === 'bottom' ? 'bg-[rgba(0,120,215,0.26)] shadow-[inset_0_0_0_2px_rgba(0,120,215,0.72),0_0_0_1px_rgba(0,120,215,0.3)]' : ''}`}
                  onDragOver={(event) => onOverlayDragOver('bottom', event)}
                  onDragLeave={onOverlayDragLeave}
                  onDrop={(event) => onOverlayDrop('bottom', event)}
                />
              </div>
            ) : null}
          </div>
        )}
      </div>
    )
  }

  const activeZoneDirection = dropPreview?.direction ?? null
  const workspaceBodyClassName = `relative h-full min-h-0 min-w-0 overflow-hidden ${
    hasSplitLayout ? 'bg-black/26 backdrop-blur-2xl' : 'bg-[#121212]/80 backdrop-blur-xl'
  } ${isBrowserTab && !pageGestureActive ? 'bg-transparent backdrop-blur-none' : ''}`

  return (
    <section className="glass-panel relative flex min-w-0 flex-1 flex-col overflow-hidden bg-transparent">
      <div
        className={`absolute left-0 right-0 top-0 z-36 h-9 pointer-events-auto bg-black/26 backdrop-blur-2xl [-webkit-app-region:drag] transition-all duration-180 ${titlebarVisible ? 'translate-y-0 opacity-100' : '-translate-y-full opacity-0'} ${isBrowserTab ? 'pointer-events-none bg-transparent backdrop-blur-none' : ''}`}
      />
      <div className={`min-h-0 min-w-0 flex-1 transition-[padding-top] duration-180 ${titlebarVisible && !isBrowserTab ? 'pt-9' : 'pt-0'}`}>
        <div className={workspaceBodyClassName}>
          <div
            ref={pageViewportRef}
            className="relative h-full min-h-0 min-w-0 w-full overflow-hidden"
            onWheelCapture={onWorkspaceWheel}
            onMouseDownCapture={settlePageGestureOnInteraction}
            onPointerDownCapture={settlePageGestureOnInteraction}
            onFocusCapture={settlePageGestureOnInteraction}
          >
            <div
              ref={pageTrackRef}
              className={`flex h-full min-h-0 items-stretch will-change-transform transition-transform duration-[180ms] [transition-timing-function:cubic-bezier(0.2,0.8,0.2,1)] ${pageGestureActive ? 'transition-none' : ''}`}
              style={{
                transform: `translate3d(${pageTrackOffset}px, 0, 0)`,
              }}
            >
              {workspacePages.map(renderPage)}
            </div>
            {isBrowserTab && hasWorkspacePaging ? (
              <>
                <div
                  className="absolute left-0 top-0 bottom-0 z-40 cursor-ew-resize bg-transparent [-webkit-app-region:no-drag]"
                  style={{ width: `${BROWSER_SWIPE_EDGE_WIDTH}px` }}
                  onWheelCapture={onWorkspaceWheel}
                />
                <div
                  className="absolute right-0 top-0 bottom-0 z-40 cursor-ew-resize bg-transparent [-webkit-app-region:no-drag]"
                  style={{ width: `${BROWSER_SWIPE_EDGE_WIDTH}px` }}
                  onWheelCapture={onWorkspaceWheel}
                />
              </>
            ) : null}
          </div>
        </div>
      </div>
      <div
        className={`absolute left-0 right-0 top-0 z-[9999] h-9 bg-transparent [-webkit-app-region:drag] ${titlebarVisible && !isBrowserTab ? 'pointer-events-auto' : 'pointer-events-none'} ${isBrowserTab ? '[-webkit-app-region:no-drag]' : ''}`}
      />
    </section>
  )
}
