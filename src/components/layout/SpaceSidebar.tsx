import { useEffect, useMemo, useRef, useState } from 'react'
import { Ellipsis, Loader2, RotateCcw, Globe, X } from 'lucide-react'
import type { AppSpace, AppTab, AppTabGroup, AppTabSplitNode, AppTabType, EssentialTab } from '../../types/argent'
type Props = {
  spaces: AppSpace[]
  activeSpaceId: string | null
  compactMode: boolean
  showShortcutHints: boolean
  essentialTabs: EssentialTab[]
  activeEssentialTabId: string | null
  onActivateSpace: (spaceId: string) => void
  onAddSpaceFromFolder: () => Promise<boolean>
  onAddEmptySpace: () => Promise<boolean>
  onCloneRepo: (repoUrl: string, parentDir?: string) => Promise<{ success: boolean; error?: string; parentDir?: string | null; authRequired?: boolean }>
  onToggleSpaceCollapsed: (spaceId: string, value: boolean) => void
  onRenameSpace: (spaceId: string, name: string) => void
  onDeleteSpace: (spaceId: string) => void
  onOpenSpaceInExplorer: (spaceId: string) => Promise<boolean>
  onSelectTab: (spaceId: string, tabId: string) => void
  onReorderTabs: (spaceId: string, sourceTabId: string, targetTabId: string) => void
  onCloseTab: (spaceId: string, tabId: string) => void
  onAddTab: (spaceId: string, type: AppTabType) => void
  onRenameTab: (spaceId: string, tabId: string, title: string) => void
  onAddEssentialTab: (tab: EssentialTab) => void
  onRemoveEssentialTab: (tabId: string) => void
  onOpenEssentialTab: (tabId: string) => void
  updateReady: { version: string | null } | null
  onRestartToUpdate: () => Promise<boolean>
}

type SpaceMenuState = {
  spaceId: string
  x: number
  y: number
}

type AddSpaceMenuState = {
  y: number
}

type SidebarEntry =
  | { type: 'tab'; tab: AppTab }
  | { type: 'group'; groupId: string; tabs: AppTab[] }

const TAB_DRAG_MIME = 'application/x-argent-tab'
const TAB_DRAG_FALLBACK_PREFIX = 'argent-tab:'
const SHORTCUT_LIMIT = 10

function readDragTabPayload(dataTransfer: DataTransfer | null): { spaceId: string; tabId: string } | null {
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
    const parsed = JSON.parse(candidate) as { spaceId?: string; tabId?: string }
    if (!parsed.spaceId || !parsed.tabId) {
      return null
    }
    return { spaceId: parsed.spaceId, tabId: parsed.tabId }
  } catch {
    return null
  }
}

function getShortcutLabel(index: number) {
  return index === 9 ? '0' : String(index + 1)
}

function defaultTabTitle(type: AppTabType) {
  if (type === 'ai') return 'AI Chat'
  if (type === 'browser') return 'Browser'
  if (type === 'terminal') return 'Terminal'
  if (type === 'git') return 'Git'
  return 'Editor'
}

function SpaceFolderIcon({ collapsed, withPinned }: { collapsed: boolean; withPinned: boolean }) {
  if (collapsed && withPinned) {
    return (
      <svg className="w-[16px] h-[16px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 7a2 2 0 0 1 2-2h4.2l1.6 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <circle cx="9.2" cy="13" r="1" fill="currentColor" stroke="none" />
        <circle cx="12" cy="13" r="1" fill="currentColor" stroke="none" />
        <circle cx="14.8" cy="13" r="1" fill="currentColor" stroke="none" />
      </svg>
    )
  }

  if (collapsed) {
    return (
      <svg className="w-[16px] h-[16px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 7a2 2 0 0 1 2-2h4.2l1.6 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      </svg>
    )
  }

  return (
    <svg className="w-[16px] h-[16px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9a2 2 0 0 1 2-2h4.2l1.6 2H19a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M3 11h18" />
    </svg>
  )
}

function AISparkleGlyph({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
    </svg>
  )
}

function getIcon(type: AppTabType) {
  switch (type) {
    case 'ai':
      return <AISparkleGlyph className="w-[16px] h-[16px] text-[#969696]" />
    case 'browser':
      return (
        <svg className="w-[16px] h-[16px] text-[#969696]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
          <path d="M2 12h20" />
        </svg>
      )
    case 'terminal':
      return (
        <svg className="w-[16px] h-[16px] text-[#969696]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="4 17 10 11 4 5" />
          <line x1="12" y1="19" x2="20" y2="19" />
        </svg>
      )
    case 'editor':
      return (
        <svg className="w-[16px] h-[16px] text-[#969696]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <polyline points="10 9 9 9 8 9" />
        </svg>
      )
    case 'git':
      return (
        <svg className="w-[16px] h-[16px] text-[#969696]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="6" y1="3" x2="6" y2="15" />
          <circle cx="18" cy="6" r="3" />
          <circle cx="6" cy="18" r="3" />
          <path d="M18 9a9 9 0 0 1-9 9" />
        </svg>
      )
  }
}

function renderTabIcon(tab: AppTab) {
  if (tab.type === 'ai') {
    const icon = (
      <span className="relative inline-flex h-[16px] w-[16px] items-center justify-center shrink-0">
        {tab.isGenerating ? <Loader2 className="absolute h-[14px] w-[14px] animate-spin text-[#d8d8d8]" /> : null}
        {!tab.isGenerating ? <AISparkleGlyph className="h-[16px] w-[16px] text-[#969696]" /> : null}
      </span>
    )

    if (tab.hasUnread) {
      return (
        <span className="relative inline-flex h-[16px] w-[16px] shrink-0">
          {icon}
          <span className="absolute -right-[2px] -top-[2px] h-[6px] w-[6px] rounded-full bg-[#f59e0b]" />
        </span>
      )
    }

    return icon
  }

  if (tab.type === 'browser' && tab.faviconUrl) {
    return <img className="w-[16px] h-[16px] rounded-[4px] shrink-0 pointer-events-none" src={tab.faviconUrl} alt="" draggable={false} />
  }

  return getIcon(tab.type)
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
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

function getTabShortcutLabels(space: AppSpace): Map<string, string> {
  const labels = new Map<string, string>()
  const groups = space.tabGroups ?? []
  if (groups.length === 0) {
    space.tabs.slice(0, SHORTCUT_LIMIT).forEach((tab, index) => {
      labels.set(tab.id, getShortcutLabel(index))
    })
    return labels
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
  let shortcutIndex = 0

  for (const tab of space.tabs) {
    if (shortcutIndex >= SHORTCUT_LIMIT) {
      break
    }

    const group = groupByTab.get(tab.id)
    if (!group) {
      labels.set(tab.id, getShortcutLabel(shortcutIndex))
      shortcutIndex += 1
      continue
    }

    if (emittedGroups.has(group.id)) {
      continue
    }

    const ids: string[] = []
    collectGroupTabIds(group.root, ids)
    const groupedTabs = space.tabs.filter((entry) => ids.includes(entry.id))
    if (groupedTabs.length < 2) {
      groupedTabs.forEach((entry) => {
        if (shortcutIndex < SHORTCUT_LIMIT) {
          labels.set(entry.id, getShortcutLabel(shortcutIndex))
          shortcutIndex += 1
        }
      })
      emittedGroups.add(group.id)
      continue
    }

    const primaryTabId = getPreferredGroupTabId(space, groupedTabs)
    if (primaryTabId) {
      labels.set(primaryTabId, getShortcutLabel(shortcutIndex))
      shortcutIndex += 1
    }
    emittedGroups.add(group.id)
  }

  return labels
}

function findGroupForTab(groups: AppTabGroup[] | undefined, tabId: string): AppTabGroup | null {
  if (!groups?.length) {
    return null
  }

  for (const group of groups) {
    const ids: string[] = []
    collectGroupTabIds(group.root, ids)
    if (ids.includes(tabId)) {
      return group
    }
  }

  return null
}

function buildSidebarEntries(space: AppSpace): SidebarEntry[] {
  const groups = space.tabGroups ?? []
  if (groups.length === 0) {
    return space.tabs.map((tab) => ({ type: 'tab', tab }))
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
  const entries: SidebarEntry[] = []

  for (const tab of space.tabs) {
    const group = groupByTab.get(tab.id)
    if (!group) {
      entries.push({ type: 'tab', tab })
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
        entries.push({ type: 'tab', tab: groupedTab })
      }
      emittedGroups.add(group.id)
      continue
    }

    entries.push({ type: 'group', groupId: group.id, tabs: groupedTabs })
    emittedGroups.add(group.id)
  }

  return entries
}

function toSshUrl(input: string) {
  const trimmed = input.trim()
  if (!trimmed) {
    return ''
  }
  if (trimmed.startsWith('git@')) {
    return trimmed
  }

  try {
    const parsed = new URL(trimmed)
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return ''
    }

    const path = parsed.pathname.replace(/^\/+/, '').replace(/\/$/, '')
    if (!path) {
      return ''
    }

    return `git@${parsed.host}:${path.endsWith('.git') ? path : `${path}.git`}`
  } catch {
    return ''
  }
}

function withCredentialsUrl(input: string, username: string, passwordOrToken: string) {
  try {
    const parsed = new URL(input)
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return ''
    }

    const user = encodeURIComponent(username)
    const pass = encodeURIComponent(passwordOrToken)
    parsed.username = user
    parsed.password = pass
    return parsed.toString()
  } catch {
    return ''
  }
}

export function SpaceSidebar({
  spaces,
  activeSpaceId,
  compactMode,
  showShortcutHints,
  essentialTabs,
  activeEssentialTabId,
  onActivateSpace,
  onAddSpaceFromFolder,
  onAddEmptySpace,
  onCloneRepo,
  onToggleSpaceCollapsed,
  onRenameSpace,
  onDeleteSpace,
  onOpenSpaceInExplorer,
  onSelectTab,
  onReorderTabs,
  onCloseTab,
  onAddTab,
  onRenameTab,
  onAddEssentialTab,
  onRemoveEssentialTab,
  onOpenEssentialTab,
  updateReady,
  onRestartToUpdate,
}: Props) {
  const [dragTabPayload, setDragTabPayload] = useState<{ spaceId: string; tabId: string } | null>(null)
  const [editingTab, setEditingTab] = useState<{ spaceId: string; tabId: string; value: string } | null>(null)
  const [editingSpace, setEditingSpace] = useState<{ spaceId: string; value: string } | null>(null)
  const [spaceMenu, setSpaceMenu] = useState<SpaceMenuState | null>(null)
  const [spaceMenuBusy, setSpaceMenuBusy] = useState(false)
  const [addSpaceMenu, setAddSpaceMenu] = useState<AddSpaceMenuState | null>(null)
  const [cloneRepoUrl, setCloneRepoUrl] = useState('')
  const [cloneRepoError, setCloneRepoError] = useState<string | null>(null)
  const [cloneRepoBusy, setCloneRepoBusy] = useState(false)
  const [cloneMode, setCloneMode] = useState(false)
  const [cloneParentDir, setCloneParentDir] = useState<string | null>(null)
  const [cloneAuthRequired, setCloneAuthRequired] = useState(false)
  const [cloneUsername, setCloneUsername] = useState('')
  const [clonePasswordOrToken, setClonePasswordOrToken] = useState('')
  const [browserTabDragging, setBrowserTabDragging] = useState(false)
  const existingSpaceIds = useMemo(() => new Set(spaces.map((space) => space.id)), [spaces])
  const visibleSpaceMenu = spaceMenu && existingSpaceIds.has(spaceMenu.spaceId) ? spaceMenu : null
  const visibleSpaceMenuSpace = visibleSpaceMenu ? spaces.find((entry) => entry.id === visibleSpaceMenu.spaceId) ?? null : null
  const visibleEditingSpace = editingSpace && existingSpaceIds.has(editingSpace.spaceId) ? editingSpace : null
  const hasOpenPopover = Boolean(visibleSpaceMenu || addSpaceMenu || cloneMode)

  const sidebarRef = useRef<HTMLElement | null>(null)
  const addSpaceButtonRef = useRef<HTMLButtonElement | null>(null)
  const spaceMenuRef = useRef<HTMLDivElement | null>(null)
  const addSpaceMenuRef = useRef<HTMLDivElement | null>(null)
  const windowDragRef = useRef<{ pointerStartX: number; pointerStartY: number; windowStartX: number; windowStartY: number } | null>(null)

  useEffect(() => {
    function closeWhenOutside(event: MouseEvent) {
      const target = event.target as Node | null
      if (spaceMenuRef.current && target && spaceMenuRef.current.contains(target)) {
        return
      }
      if (addSpaceMenuRef.current && target && addSpaceMenuRef.current.contains(target)) {
        return
      }
      if (addSpaceButtonRef.current && target && addSpaceButtonRef.current.contains(target)) {
        return
      }
      setSpaceMenu(null)
      setAddSpaceMenu(null)
      setCloneMode(false)
      setCloneRepoError(null)
      setCloneAuthRequired(false)
    }

    document.addEventListener('mousedown', closeWhenOutside, true)
    document.addEventListener('contextmenu', closeWhenOutside, true)

    return () => {
      document.removeEventListener('mousedown', closeWhenOutside, true)
      document.removeEventListener('contextmenu', closeWhenOutside, true)
    }
  }, [])

  useEffect(() => {
    const dismissMenus = () => {
      setSpaceMenu(null)
      setAddSpaceMenu(null)
      setCloneMode(false)
      setCloneRepoError(null)
      setCloneAuthRequired(false)
    }

    window.addEventListener('argent:sidebar-dismiss-menus', dismissMenus)
    return () => {
      window.removeEventListener('argent:sidebar-dismiss-menus', dismissMenus)
    }
  }, [])

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('argent:sidebar-popover-lock', { detail: { locked: hasOpenPopover } }))
    return () => {
      window.dispatchEvent(new CustomEvent('argent:sidebar-popover-lock', { detail: { locked: false } }))
    }
  }, [hasOpenPopover])

  useEffect(() => {
    function stopWindowDrag() {
      windowDragRef.current = null
    }

    function moveWindow(event: MouseEvent) {
      const dragState = windowDragRef.current
      if (!dragState) {
        return
      }

      const nextX = dragState.windowStartX + (event.screenX - dragState.pointerStartX)
      const nextY = dragState.windowStartY + (event.screenY - dragState.pointerStartY)
      void window.argent.window.setPosition(nextX, nextY)
    }

    window.addEventListener('mousemove', moveWindow)
    window.addEventListener('mouseup', stopWindowDrag)
    window.addEventListener('blur', stopWindowDrag)

    return () => {
      window.removeEventListener('mousemove', moveWindow)
      window.removeEventListener('mouseup', stopWindowDrag)
      window.removeEventListener('blur', stopWindowDrag)
    }
  }, [])

  function toggleCollapsed(spaceId: string) {
    const space = spaces.find((entry) => entry.id === spaceId)
    if (!space) {
      return
    }
    onToggleSpaceCollapsed(spaceId, !(space.collapsed ?? false))
  }

  function isBrowserTabPayload(payload: { spaceId: string; tabId: string } | null) {
    if (!payload) {
      return false
    }

    const space = spaces.find((entry) => entry.id === payload.spaceId)
    const tab = space?.tabs.find((entry) => entry.id === payload.tabId)
    return Boolean(tab && tab.type === 'browser' && 'url' in tab && tab.url)
  }

  function clearTabDragState() {
    setBrowserTabDragging(false)
    setDragTabPayload(null)
    window.dispatchEvent(new Event('argent:tab-drag-end'))
  }

  function onTabDrop(event: React.DragEvent<HTMLElement>, spaceId: string, targetTabId: string) {
    event.preventDefault()
    const payload = dragTabPayload ?? readDragTabPayload(event.dataTransfer)
    if (!payload || payload.spaceId !== spaceId || payload.tabId === targetTabId) {
      clearTabDragState()
      return
    }

    onReorderTabs(spaceId, payload.tabId, targetTabId)
    clearTabDragState()
  }

  useEffect(() => {
    const clearDragState = () => {
      setBrowserTabDragging(false)
      setDragTabPayload(null)
    }

    window.addEventListener('dragend', clearDragState)
    window.addEventListener('drop', clearDragState)
    return () => {
      window.removeEventListener('dragend', clearDragState)
      window.removeEventListener('drop', clearDragState)
    }
  }, [])

  function setTabDragData(event: React.DragEvent<HTMLElement>, spaceId: string, tab: AppTab) {
    const payload = JSON.stringify({ spaceId, tabId: tab.id })
    event.dataTransfer.setData(TAB_DRAG_MIME, payload)
    event.dataTransfer.setData('text/plain', `${TAB_DRAG_FALLBACK_PREFIX}${spaceId}:${tab.id}`)
    event.dataTransfer.effectAllowed = 'move'
    setDragTabPayload({ spaceId, tabId: tab.id })
    setBrowserTabDragging(tab.type === 'browser')
    window.dispatchEvent(new CustomEvent('argent:tab-drag-start', { detail: { spaceId, tabId: tab.id } }))
  }

  function commitTabRename(spaceId: string, tabId: string, fallbackType: AppTabType) {
    if (!editingTab || editingTab.spaceId !== spaceId || editingTab.tabId !== tabId) {
      return
    }

    const trimmed = editingTab.value.trim()
    const nextTitle = trimmed || defaultTabTitle(fallbackType)
    onRenameTab(spaceId, tabId, nextTitle)
    setEditingTab(null)
  }

  function commitSpaceRename(spaceId: string) {
    if (!editingSpace || editingSpace.spaceId !== spaceId) {
      return
    }

    const trimmed = editingSpace.value.trim()
    if (trimmed) {
      onRenameSpace(spaceId, trimmed)
    }
    setEditingSpace(null)
  }

  function signalUiInteraction() {
    window.dispatchEvent(new Event('argent:ui-interaction'))
  }

  function canStartWindowDrag(target: EventTarget | null) {
    if (!(target instanceof Element)) {
      return false
    }

    return !target.closest('.no-drag-region, button, input, textarea, [contenteditable="true"]')
  }

  function handleSidebarMouseDown(event: React.MouseEvent<HTMLElement>) {
    signalUiInteraction()

    const target = event.target as Node | null
    const clickedInsideMenu =
      (spaceMenuRef.current && target && spaceMenuRef.current.contains(target)) ||
      (addSpaceMenuRef.current && target && addSpaceMenuRef.current.contains(target))

    if (event.button === 0 && !clickedInsideMenu) {
      setSpaceMenu(null)
      setAddSpaceMenu(null)
      setCloneMode(false)
      setCloneRepoError(null)
      setCloneAuthRequired(false)
    }

    if (event.button !== 0 || clickedInsideMenu || !canStartWindowDrag(event.target)) {
      return
    }

    const { screenX, screenY } = event
    void (async () => {
      const bounds = await window.argent.window.getBounds()
      if (!bounds || bounds.isMaximized) {
        return
      }

      windowDragRef.current = {
        pointerStartX: screenX,
        pointerStartY: screenY,
        windowStartX: bounds.x,
        windowStartY: bounds.y,
      }
    })()
  }

  function openSpaceMenuAt(spaceId: string, x: number, y: number) {
    const sidebarRect = sidebarRef.current?.getBoundingClientRect()
    const menuWidth = 192
    const menuHeight = 120

    if (!sidebarRect) {
      setSpaceMenu({
        spaceId,
        x: clamp(x, 6, window.innerWidth - menuWidth - 6),
        y: clamp(y, 6, window.innerHeight - menuHeight - 6),
      })
      setAddSpaceMenu(null)
      return
    }

    const relativeX = clamp(x - sidebarRect.left, 6, sidebarRect.width - menuWidth - 6)
    const relativeY = clamp(y - sidebarRect.top, 6, sidebarRect.height - menuHeight - 6)

    setSpaceMenu({ spaceId, x: relativeX, y: relativeY })
    setAddSpaceMenu(null)
  }

  function openSpaceMenuFromRect(spaceId: string, rect: DOMRect) {
    const sidebarRect = sidebarRef.current?.getBoundingClientRect()
    const menuWidth = 192
    const menuHeight = 120

    if (!sidebarRect) {
      openSpaceMenuAt(spaceId, rect.right, rect.bottom + 4)
      return
    }

    const preferredX = rect.right - sidebarRect.left - menuWidth
    const preferredY = rect.bottom - sidebarRect.top + 4

    setSpaceMenu({
      spaceId,
      x: clamp(preferredX, 6, sidebarRect.width - menuWidth - 6),
      y: clamp(preferredY, 6, sidebarRect.height - menuHeight - 6),
    })
    setAddSpaceMenu(null)
  }

  function toggleAddSpaceMenu() {
    if (addSpaceMenu) {
      setAddSpaceMenu(null)
      setCloneMode(false)
      setCloneRepoError(null)
      setCloneAuthRequired(false)
      return
    }

    const buttonRect = addSpaceButtonRef.current?.getBoundingClientRect()
    const sidebarRect = sidebarRef.current?.getBoundingClientRect()
    if (!buttonRect || !sidebarRect) {
      return
    }

    const menuHeight = 220
    const y = clamp(buttonRect.bottom - sidebarRect.top + 6, 6, sidebarRect.height - menuHeight - 6)

    setAddSpaceMenu({ y })
    setSpaceMenu(null)
    setCloneRepoError(null)
    setCloneAuthRequired(false)
    setCloneParentDir(null)
    setCloneUsername('')
    setClonePasswordOrToken('')
  }

  async function handleCloneRepoSubmit(urlOverride?: string) {
    const url = (urlOverride ?? cloneRepoUrl).trim()
    if (!url) {
      setCloneRepoError('Enter a repository URL.')
      return
    }

    setCloneRepoBusy(true)
    setCloneRepoError(null)
    const result = await onCloneRepo(url, cloneParentDir || undefined)
    setCloneRepoBusy(false)

    if (!result.success) {
      setCloneRepoError(result.error || 'Could not clone repository.')
      setCloneAuthRequired(Boolean(result.authRequired))
      if (result.parentDir) {
        setCloneParentDir(result.parentDir)
      }
      return
    }

    setCloneRepoUrl('')
    setCloneMode(false)
    setAddSpaceMenu(null)
    setCloneParentDir(null)
    setCloneAuthRequired(false)
    setCloneUsername('')
    setClonePasswordOrToken('')
  }

  async function handleCloneWithCredentials() {
    const username = cloneUsername.trim()
    const password = clonePasswordOrToken.trim()
    if (!username || !password) {
      setCloneRepoError('Enter username and password/token.')
      return
    }

    const url = withCredentialsUrl(cloneRepoUrl, username, password)
    if (!url) {
      setCloneRepoError('Credentials can only be used with an HTTPS repository URL.')
      return
    }

    await handleCloneRepoSubmit(url)
  }

  async function handleUseSshClone() {
    const sshUrl = toSshUrl(cloneRepoUrl)
    if (!sshUrl) {
      setCloneRepoError('Could not convert this URL to SSH format.')
      return
    }

    setCloneRepoUrl(sshUrl)
    await handleCloneRepoSubmit(sshUrl)
  }

  return (
    <aside
      ref={sidebarRef}
      className={`drag-region h-full w-[292px] flex-shrink-0 flex flex-col pt-3 pb-3 px-3 gap-3 relative ${
        compactMode ? 'rounded-xl border border-white/8 bg-[#1a1a1a] shadow-[0_18px_48px_rgba(0,0,0,0.45)]' : 'bg-black/26 backdrop-blur-2xl'
      }`}
      onMouseDownCapture={handleSidebarMouseDown}
      onContextMenuCapture={signalUiInteraction}
      onContextMenu={(event) => {
        const target = event.target as Element | null
        if (target?.closest('[data-space-menu-area="true"], [data-space-entry="true"]')) {
          return
        }
        event.preventDefault()
      }}
    >
      <div className="no-drag-region flex items-center justify-between px-2">
        <div className="text-sm font-semibold text-[#d0d0d0] tracking-wide">Argent</div>
        <button
          ref={addSpaceButtonRef}
          className="text-[12px] text-[#9a9a9a] hover:text-[#e0e0e0] px-2 py-1 rounded-md cursor-pointer transition-colors hover:bg-white/8 outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0"
          onClick={toggleAddSpaceMenu}
        >
          Add Space
        </button>
      </div>

      {addSpaceMenu ? (
        <div
          ref={addSpaceMenuRef}
          data-space-menu-area="true"
          className={`no-drag-region absolute z-50 bg-[#141414]/90 backdrop-blur-xl border border-white/5 rounded-md shadow-2xl py-1.5 text-[12px] text-[#a3a3a3] ${cloneMode ? 'w-64' : 'w-48'}`}
          style={{
            right: 6,
            top: addSpaceMenu.y,
          }}
        >
          {!cloneMode ? (
            <div>
              <button
                className="w-full text-left px-3 py-1.5 hover:bg-white/10 hover:text-[#d4d4d4] transition-colors"
                onClick={async () => {
                  const added = await onAddSpaceFromFolder()
                  if (added) {
                    setAddSpaceMenu(null)
                  }
                }}
              >
                Open Folder
              </button>
              <button
                className="w-full text-left px-3 py-1.5 hover:bg-white/10 hover:text-[#d4d4d4] transition-colors"
                onClick={() => {
                  setCloneMode(true)
                  setCloneRepoError(null)
                }}
              >
                Clone Repo
              </button>
              <button
                className="w-full text-left px-3 py-1.5 hover:bg-white/10 hover:text-[#d4d4d4] transition-colors"
                onClick={async () => {
                  const added = await onAddEmptySpace()
                  if (added) {
                    setAddSpaceMenu(null)
                  }
                }}
              >
                Empty Space
              </button>
            </div>
          ) : (
            <div className="flex flex-col px-3 pb-2 gap-2">
              <div className="text-[11px] text-[#8a8a8a] pt-1">Clone Repository URL</div>
              <input
                autoFocus
                value={cloneRepoUrl}
                onChange={(event) => setCloneRepoUrl(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void handleCloneRepoSubmit()
                  }
                  if (event.key === 'Escape') {
                    setCloneMode(false)
                    setCloneRepoError(null)
                    setCloneAuthRequired(false)
                  }
                }}
                className="w-full bg-[#101010]/85 border border-white/8 rounded-md px-2.5 py-2 text-[#d3d3d3] outline-none focus:border-white/16"
                placeholder="https://github.com/owner/repo.git"
              />

              {cloneAuthRequired ? (
                <>
                  <div className="text-[11px] text-[#8a8a8a] pt-1">Authentication required</div>
                  <input
                    value={cloneUsername}
                    onChange={(event) => setCloneUsername(event.target.value)}
                    className="w-full bg-[#101010]/85 border border-white/8 rounded-md px-2.5 py-2 text-[#d3d3d3] outline-none focus:border-white/16"
                    placeholder="Username"
                  />
                  <input
                    type="password"
                    value={clonePasswordOrToken}
                    onChange={(event) => setClonePasswordOrToken(event.target.value)}
                    className="w-full bg-[#101010]/85 border border-white/8 rounded-md px-2.5 py-2 text-[#d3d3d3] outline-none focus:border-white/16"
                    placeholder="Password or token"
                  />
                  <button
                    className="w-full text-left px-3 py-1.5 rounded-md hover:bg-white/10 hover:text-[#d4d4d4] transition-colors"
                    onClick={() => {
                      void handleUseSshClone()
                    }}
                    disabled={cloneRepoBusy}
                  >
                    Use SSH Agent Instead
                  </button>
                </>
              ) : null}

              {cloneRepoError ? <div className="text-[11px] text-[#e29797]">{cloneRepoError}</div> : null}
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  className="px-3 py-1.5 text-[#9a9a9a] hover:text-[#d3d3d3] hover:bg-white/10 transition-colors rounded-md"
                  onClick={() => {
                    setCloneMode(false)
                    setCloneRepoError(null)
                    setCloneAuthRequired(false)
                  }}
                  disabled={cloneRepoBusy}
                >
                  Back
                </button>
                <button
                  className="px-3 py-1.5 text-[#d5d5d5] bg-white/12 hover:bg-white/16 transition-colors rounded-md disabled:opacity-50"
                  onClick={() => {
                    if (cloneAuthRequired) {
                      void handleCloneWithCredentials()
                      return
                    }
                    void handleCloneRepoSubmit()
                  }}
                  disabled={cloneRepoBusy}
                >
                  {cloneRepoBusy ? 'Cloning...' : cloneAuthRequired ? 'Retry Clone' : 'Clone'}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}

      <div
        className={`no-drag-region flex flex-col ${essentialTabs.length > 0 || browserTabDragging ? 'gap-1.5' : 'gap-0'}`}
        onDrop={(e) => {
          e.preventDefault()
          e.stopPropagation()
          const payload = dragTabPayload ?? readDragTabPayload(e.dataTransfer)
          if (!payload) {
            setBrowserTabDragging(false)
            return
          }
          const space = spaces.find(s => s.id === payload.spaceId)
          const tab = space?.tabs.find(t => t.id === payload.tabId)
          if (tab && tab.type === 'browser' && 'url' in tab && tab.url) {
            onAddEssentialTab({
              id: tab.id,
              title: tab.title,
              url: tab.url,
              faviconUrl: tab.faviconUrl || `https://www.google.com/s2/favicons?domain=${new URL(tab.url).hostname}&sz=32`,
            })
          }
          setBrowserTabDragging(false)
          setDragTabPayload(null)
        }}
        onDragOver={(e) => {
          const payload = dragTabPayload ?? readDragTabPayload(e.dataTransfer)
          if (browserTabDragging || isBrowserTabPayload(payload)) {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            setBrowserTabDragging(true)
          }
        }}
        onDragEnter={(e) => {
          const payload = dragTabPayload ?? readDragTabPayload(e.dataTransfer)
          if (browserTabDragging || isBrowserTabPayload(payload)) {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            setBrowserTabDragging(true)
          }
        }}
      >
          {essentialTabs.length > 0 ? (
          <div className={`flex gap-2 rounded-xl border border-dashed transition-colors ${browserTabDragging ? 'border-white/50' : 'border-transparent'}`}>
            {essentialTabs.map((tab) => {
              const isActive = activeEssentialTabId === tab.id
              return (
              <div key={tab.id} className="group relative flex-1 min-w-0">
                <button
                  type="button"
                  className={`w-full h-12 rounded-xl transition-all duration-150 flex items-center justify-center px-2 cursor-pointer ${
                    isActive ? 'bg-white/12 border border-white/16' : 'bg-white/6 hover:bg-white/10 border border-transparent'
                  }`}
                  onClick={() => onOpenEssentialTab(tab.id)}
                >
                  {tab.faviconUrl ? (
                    <img className="w-6 h-6 rounded shrink-0 pointer-events-none" src={tab.faviconUrl} alt="" draggable={false} />
                  ) : (
                    <Globe className="w-6 h-6 shrink-0 text-[#6a6a6a]" />
                  )}
                </button>
                <button
                  className="absolute -top-1 -right-1 p-0.5 rounded-full bg-[#1a1a1a] border border-white/12 opacity-0 group-hover:opacity-100 hover:bg-red-500/80 text-[#8e8e8e] hover:text-white transition-all cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation()
                    onRemoveEssentialTab(tab.id)
                  }}
                  title="Remove"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </div>
              )
            })}
          </div>
          ) : null}
          {essentialTabs.length === 0 ? (
            <div
              className={`rounded-xl flex items-center justify-center overflow-hidden transition-all ${
                browserTabDragging
                  ? 'h-12 border border-dashed border-white/50 opacity-100'
                  : 'h-0 border-0 opacity-0 pointer-events-none'
              }`}
            >
              <span className="text-[11px] text-[#6a6a6a]">Drop browser tab here</span>
            </div>
          ) : null}
        </div>

      <div className="drag-region flex flex-col gap-1 px-1">
        <div className="text-[12px] font-medium text-[#7e7e7e] px-1">Projects</div>
      </div>

      <div className="drag-region flex-1 min-h-0 flex flex-col gap-0.5 overflow-auto pr-1">
        {spaces.filter(s => !s.isEssential).map((space, spaceIndex) => {
          const isActive = !activeEssentialTabId && space.id === activeSpaceId
          const isCollapsed = existingSpaceIds.has(space.id) && Boolean(space.collapsed)
          const activeSpaceTab = space.tabs.find((tab) => tab.id === space.activeTabId) ?? null
          const activeSpaceGroup = activeSpaceTab ? findGroupForTab(space.tabGroups, activeSpaceTab.id) : null
          const activeGroupTabIds = (() => {
            if (!activeSpaceGroup) {
              return [] as string[]
            }
            const ids: string[] = []
            collectGroupTabIds(activeSpaceGroup.root, ids)
            return ids
          })()
          const activeGroupTabs = space.tabs.filter((tab) => activeGroupTabIds.includes(tab.id)).slice(0, 4)
          const showCollapsedPreview = isActive && isCollapsed && Boolean(activeSpaceTab)
          const isGlobalSpace = (space.kind ?? 'project') === 'global'
          const entries = buildSidebarEntries(space)
          const showSpaceShortcutHint = showShortcutHints && spaceIndex < SHORTCUT_LIMIT
          const showTabShortcutHints = showShortcutHints && isActive
          const tabShortcutLabels = getTabShortcutLabels(space)

          return (
            <div key={space.id} className="drag-region flex flex-col" data-space-entry="true">
              <div className={`drag-region group relative w-full rounded-lg transition-colors ${isActive ? 'bg-white/10' : browserTabDragging ? '' : 'hover:bg-white/8'}`}>
                <button
                  className={`relative w-full text-[13px] px-2.5 pr-8 py-1.5 rounded-lg transition-colors flex items-center gap-2 font-medium cursor-pointer text-left ${isActive ? 'text-[#f1f1f1]' : 'text-[#b6b6b6]'}`}
                  onClick={() => {
                    toggleCollapsed(space.id)
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    openSpaceMenuAt(space.id, event.clientX, event.clientY)
                  }}
                >
                  <span className={isActive ? 'text-[#d8d8d8]' : 'text-[#969696]'}>
                    <SpaceFolderIcon collapsed={isCollapsed} withPinned={showCollapsedPreview} />
                  </span>
                  {visibleEditingSpace?.spaceId === space.id ? (
                    <input
                      autoFocus
                      value={visibleEditingSpace.value}
                      className="flex-1 bg-transparent border-none outline-none text-[#ececec]"
                      onChange={(event) => setEditingSpace({ spaceId: space.id, value: event.target.value })}
                      onBlur={() => commitSpaceRename(space.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          commitSpaceRename(space.id)
                        }
                        if (event.key === 'Escape') {
                          setEditingSpace(null)
                        }
                      }}
                    />
                  ) : (
                    <span className="truncate">{space.name}</span>
                  )}
                  {showSpaceShortcutHint ? (
                    <span
                      className={`pointer-events-none absolute top-1/2 -translate-y-1/2 rounded-[6px] bg-white/14 px-2 py-[1px] text-[11px] text-[#ececec] transition-all ${
                        visibleSpaceMenu?.spaceId === space.id ? 'right-8' : 'right-1 group-hover:right-8'
                      }`}
                    >
                      Shift+{getShortcutLabel(spaceIndex)}
                    </span>
                  ) : null}
                </button>

                <button
                  className={`absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded-md text-[#7f7f7f] hover:text-[#d6d6d6] transition-colors ${visibleSpaceMenu?.spaceId === space.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    const rect = event.currentTarget.getBoundingClientRect()
                    openSpaceMenuFromRect(space.id, rect)
                  }}
                >
                  <Ellipsis className="w-[14px] h-[14px]" />
                </button>
              </div>

              {showCollapsedPreview && activeSpaceTab ? (
                <div className="drag-region flex flex-col mt-1 mb-2 ml-4 pl-3 border-l border-white/12">
                  {activeGroupTabs.length >= 2 ? (
                    <div className="rounded-md bg-white/9 border border-white/10 p-1 grid grid-cols-2 gap-1">
                      {activeGroupTabs.map((tab) => (
                        <button
                          key={tab.id}
                          className="no-drag-region h-7 rounded-[7px] px-1.5 text-[11px] flex items-center gap-1.5 truncate bg-white/6 text-[#b9b9b9]"
                          onClick={() => {
                            onActivateSpace(space.id)
                            onSelectTab(space.id, activeSpaceTab.id)
                          }}
                          onMouseDown={(event) => {
                            if (event.button === 1) {
                              event.preventDefault()
                              event.stopPropagation()
                              onCloseTab(space.id, tab.id)
                            }
                          }}
                          onAuxClick={(event) => {
                            if (event.button === 1) {
                              event.preventDefault()
                              event.stopPropagation()
                            }
                          }}
                          draggable
                          onDragStart={(event) => {
                            event.stopPropagation()
                            setTabDragData(event, space.id, tab)
                          }}
                          onDragEnd={clearTabDragState}
                        >
                          <span className="shrink-0">{renderTabIcon(tab)}</span>
                          <span className="truncate">{tab.title}</span>
                          {showTabShortcutHints && tabShortcutLabels.has(tab.id) ? (
                            <span className="ml-auto shrink-0 rounded-[5px] bg-white/14 px-1 py-[1px] text-[10px] text-[#ececec]">
                              {tabShortcutLabels.get(tab.id)}
                            </span>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <button
                      className="flex items-center gap-2 px-2.5 py-1.5 text-[12.5px] rounded-md text-[#d7d7d7] bg-white/8 text-left truncate"
                      onMouseDown={(event) => {
                        if (event.button === 1) {
                          event.preventDefault()
                          event.stopPropagation()
                          onCloseTab(space.id, activeSpaceTab.id)
                        }
                      }}
                      onAuxClick={(event) => {
                        if (event.button === 1) {
                          event.preventDefault()
                          event.stopPropagation()
                        }
                      }}
                      onClick={() => {
                        onActivateSpace(space.id)
                        onSelectTab(space.id, activeSpaceTab.id)
                      }}
                    >
                      {renderTabIcon(activeSpaceTab)}
                      <span className="truncate">{activeSpaceTab.title}</span>
                    </button>
                  )}
                </div>
              ) : null}

              {!isCollapsed ? (
                <div className="drag-region flex flex-col gap-0.5 mt-1 mb-2 ml-4 pl-3 border-l border-white/12">
                  {entries.map((entry) => {
                    if (entry.type === 'group') {
                      const isGroupActive = isActive && entry.tabs.some((tab) => tab.id === space.activeTabId)
                      const gridCols = entry.tabs.length >= 4 ? 'grid-cols-2' : entry.tabs.length === 3 ? 'grid-cols-3' : 'grid-cols-2'

                      return (
                        <div key={entry.groupId} className={`drag-region group relative rounded-xl border transition-all ${isGroupActive ? 'border-white/16 bg-white/8' : browserTabDragging ? 'border-white/8 bg-white/4' : 'border-white/8 bg-white/4 hover:bg-white/8 hover:border-white/14'}`}>
                          <div className={`drag-region grid ${gridCols} gap-1 p-1`}>
                            {entry.tabs.slice(0, 4).map((tab) => {
                              const hasShortcutHint = showTabShortcutHints && tabShortcutLabels.has(tab.id)
                              return (
                                <div
                                  key={tab.id}
                                  className="no-drag-region group/tab relative"
                                  onDragOver={(event) => event.preventDefault()}
                                  onDrop={(event) => onTabDrop(event, space.id, tab.id)}
                                >
                                  <button
                                  className={`no-drag-region relative h-8 w-full rounded-[8px] px-1.5 pr-6 text-[11px] flex items-center gap-1.5 truncate transition-colors text-left ${isGroupActive && space.activeTabId === tab.id ? 'bg-white/12 text-[#f1f1f1]' : browserTabDragging ? 'bg-white/6 text-[#a9a9a9]' : 'bg-white/6 text-[#a9a9a9] hover:text-[#dadada]'}`}
                                  onClick={(event) => {
                                    if (event.altKey) {
                                      return
                                    }
                                    onActivateSpace(space.id)
                                    onSelectTab(space.id, tab.id)
                                  }}
                                  onMouseDown={(event) => {
                                    if (event.button === 1) {
                                      event.preventDefault()
                                      event.stopPropagation()
                                      onCloseTab(space.id, tab.id)
                                    }
                                  }}
                                  onAuxClick={(event) => {
                                    if (event.button === 1) {
                                      event.preventDefault()
                                      event.stopPropagation()
                                    }
                                  }}
                                  draggable
                                  onDragStart={(event) => {
                                    event.stopPropagation()
                                    setTabDragData(event, space.id, tab)
                                  }}
                                  onDragEnd={clearTabDragState}
                                >
                                  <span className="shrink-0">{renderTabIcon(tab)}</span>
                                  <span className={`truncate transition-[padding-right] ${hasShortcutHint ? 'pr-[22px] group-hover/tab:pr-[46px]' : 'pr-1 group-hover/tab:pr-[26px]'}`}>{tab.title}</span>
                                  {hasShortcutHint ? (
                                    <span className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 rounded-[5px] bg-white/14 px-1 py-[1px] text-[10px] text-[#ececec] transition-all group-hover/tab:right-6">
                                      {tabShortcutLabels.get(tab.id)}
                                    </span>
                                  ) : null}
                                </button>

                                <button
                                  className={`absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-1 text-[#8e8e8e] opacity-0 transition-all hover:bg-white/12 hover:text-white ${browserTabDragging ? 'pointer-events-none opacity-0' : 'group-hover/tab:opacity-100'}`}
                                  onClick={(event) => {
                                    event.preventDefault()
                                    event.stopPropagation()
                                    onCloseTab(space.id, tab.id)
                                  }}
                                  aria-label={`Close ${tab.title}`}
                                >
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M18 6L6 18M6 6l12 12" />
                                  </svg>
                                </button>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )
                    }

                    const tab = entry.tab
                    const hasShortcutHint = showTabShortcutHints && tabShortcutLabels.has(tab.id)
                    return (
                      <div
                        key={tab.id}
                        className="no-drag-region flex items-center relative group"
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => onTabDrop(event, space.id, tab.id)}
                      >
                        {editingTab?.spaceId === space.id && editingTab?.tabId === tab.id ? (
                          <div className="flex-1 flex items-center gap-2 px-2.5 py-1.5 text-[12.5px] rounded-md bg-white/12">
                            {renderTabIcon(tab)}
                            <input
                              autoFocus
                              className="w-full bg-transparent border-none outline-none text-[#e9e9e9]"
                              value={editingTab.value}
                              onChange={(event) => setEditingTab((current) => (current ? { ...current, value: event.target.value } : current))}
                              onBlur={() => commitTabRename(space.id, tab.id, tab.type)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                  commitTabRename(space.id, tab.id, tab.type)
                                }
                                if (event.key === 'Escape') {
                                  setEditingTab(null)
                                }
                              }}
                            />
                          </div>
                        ) : (
                          <button
                            className={`no-drag-region relative flex-1 flex items-center gap-2 px-2.5 py-1.5 text-[12.5px] rounded-md transition-colors text-left truncate ${isActive && space.activeTabId === tab.id ? 'text-[#e9e9e9] bg-white/12' : browserTabDragging ? 'text-[#9a9a9a]' : 'text-[#9a9a9a] hover:text-[#d7d7d7] hover:bg-white/8'}`}
                            draggable
                            onDragStart={(event) => {
                              event.stopPropagation()
                              setTabDragData(event, space.id, tab)
                            }}
                            onDragEnd={clearTabDragState}
                            onMouseDown={(event) => {
                              if (event.button === 1) {
                                event.preventDefault()
                                event.stopPropagation()
                                onCloseTab(space.id, tab.id)
                              }
                            }}
                            onAuxClick={(event) => {
                              if (event.button === 1) {
                                event.preventDefault()
                                event.stopPropagation()
                              }
                            }}
                            onClick={() => {
                              onActivateSpace(space.id)
                              onSelectTab(space.id, tab.id)
                            }}
                            onDoubleClick={() => {
                              if (isActive && space.activeTabId === tab.id) {
                                setEditingTab({ spaceId: space.id, tabId: tab.id, value: tab.title })
                              }
                            }}
                          >
                            {renderTabIcon(tab)}
                            <span className={`truncate transition-[padding-right] ${hasShortcutHint ? 'pr-[22px] group-hover:pr-[46px]' : 'pr-1 group-hover:pr-[26px]'}`}>{tab.title}</span>
                            {hasShortcutHint ? (
                              <span className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 rounded-[6px] bg-white/12 px-1.5 py-[1px] text-[10px] text-[#dcdcdc] transition-all group-hover:right-7">
                                {tabShortcutLabels.get(tab.id)}
                              </span>
                            ) : null}
                          </button>
                        )}

                        <button
                          className={`absolute right-1 p-1 rounded-md opacity-0 hover:bg-white/12 text-[#9a9a9a] hover:text-white transition-all cursor-pointer ${browserTabDragging ? 'pointer-events-none opacity-0' : 'group-hover:opacity-100'}`}
                          onClick={() => onCloseTab(space.id, tab.id)}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M18 6L6 18M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    )
                  })}

                  <div className="no-drag-region flex flex-col gap-1 mt-1.5 px-1">
                    <div className="text-[11px] text-[#7b7b7b] px-2">New Tab</div>
                    <div className="flex gap-1 pl-2">
                      <button
                        className="text-xs text-[#7f7f7f] hover:text-[#dfdfdf] p-1.5 rounded-md hover:bg-white/10 transition-colors cursor-pointer flex items-center gap-1.5"
                        onClick={() => onAddTab(space.id, 'ai')}
                        title="AI Chat"
                      >
                        {getIcon('ai')}
                      </button>
                      <button
                        className="text-xs text-[#7f7f7f] hover:text-[#dfdfdf] p-1.5 rounded-md hover:bg-white/10 transition-colors cursor-pointer flex items-center gap-1.5"
                        onClick={() => onAddTab(space.id, 'browser')}
                        title="Browser"
                      >
                        {getIcon('browser')}
                      </button>
                      <button
                        className="text-xs text-[#7f7f7f] hover:text-[#dfdfdf] p-1.5 rounded-md hover:bg-white/10 transition-colors cursor-pointer flex items-center gap-1.5"
                        onClick={() => onAddTab(space.id, 'terminal')}
                        title="Terminal"
                      >
                        {getIcon('terminal')}
                      </button>
                      {!isGlobalSpace ? (
                        <button
                          className="text-xs text-[#7f7f7f] hover:text-[#dfdfdf] p-1.5 rounded-md hover:bg-white/10 transition-colors cursor-pointer flex items-center gap-1.5"
                          onClick={() => onAddTab(space.id, 'editor')}
                          title="Editor"
                        >
                          {getIcon('editor')}
                        </button>
                      ) : null}
                      {!isGlobalSpace ? (
                        <button
                          className="text-xs text-[#7f7f7f] hover:text-[#dfdfdf] p-1.5 rounded-md hover:bg-white/10 transition-colors cursor-pointer flex items-center gap-1.5"
                          onClick={() => onAddTab(space.id, 'git')}
                          title="Git"
                        >
                          {getIcon('git')}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          )
        })}
      </div>

      {updateReady ? (
        <div className="no-drag-region mt-2 px-1">
          <button
            className="w-full rounded-xl border border-amber-200/12 bg-amber-200/[0.12] px-3 py-2.5 text-left transition-colors hover:bg-amber-200/[0.16]"
            onClick={() => {
              void onRestartToUpdate()
            }}
          >
            <span className="flex items-start gap-2.5">
              <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-amber-100/20 text-amber-100/90">
                <RotateCcw className="h-3.5 w-3.5" />
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-amber-50/95">
                  Argent is ready to update!
                </span>
                <span className="mt-0.5 block text-[11.5px] text-amber-100/70">
                  Click to restart{updateReady.version ? ` · v${updateReady.version}` : ''}
                </span>
              </span>
            </span>
          </button>
        </div>
      ) : null}

      {visibleSpaceMenu ? (
        <div
          ref={spaceMenuRef}
          data-space-menu-area="true"
          className="no-drag-region absolute z-50 bg-[#141414]/90 backdrop-blur-xl border border-white/5 rounded-md shadow-2xl py-1.5 w-48 text-[12px] text-[#a3a3a3]"
          style={{ left: visibleSpaceMenu.x, top: visibleSpaceMenu.y }}
        >
          <button
            className="w-full text-left px-3 py-1.5 hover:bg-white/10 hover:text-[#d4d4d4] transition-colors"
            disabled={spaceMenuBusy}
            onClick={() => {
              const space = spaces.find((entry) => entry.id === visibleSpaceMenu.spaceId)
              if (!space) {
                setSpaceMenu(null)
                return
              }
              setEditingSpace({ spaceId: space.id, value: space.name })
              setSpaceMenu(null)
            }}
          >
            Rename Space
          </button>
          {visibleSpaceMenuSpace && (visibleSpaceMenuSpace.kind ?? 'project') !== 'global' ? (
            <button
              className="w-full text-left px-3 py-1.5 hover:bg-white/10 hover:text-[#d4d4d4] transition-colors"
              disabled={spaceMenuBusy}
              onClick={async () => {
                setSpaceMenuBusy(true)
                await onOpenSpaceInExplorer(visibleSpaceMenu.spaceId)
                setSpaceMenuBusy(false)
                setSpaceMenu(null)
              }}
            >
              Open in Explorer
            </button>
          ) : null}
          <div className="h-[1px] bg-white/5 my-1.5 w-[calc(100%-16px)] mx-auto" />
          <button
            className="w-full text-left px-3 py-1.5 hover:bg-red-500/20 text-red-500 hover:text-red-400 transition-colors"
            disabled={spaceMenuBusy}
            onClick={() => {
              onDeleteSpace(visibleSpaceMenu.spaceId)
              setSpaceMenu(null)
            }}
          >
            Delete Space
          </button>
        </div>
      ) : null}

    </aside>
    
  )
}
