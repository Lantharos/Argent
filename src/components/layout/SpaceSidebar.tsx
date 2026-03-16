import { useEffect, useMemo, useRef, useState } from 'react'
import { Ellipsis, Loader2 } from 'lucide-react'
import type { AppSpace, AppTab, AppTabType } from '../../types/opensmith'

type Props = {
  spaces: AppSpace[]
  activeSpaceId: string | null
  onActivateSpace: (spaceId: string) => void
  onAddSpaceFromFolder: () => Promise<boolean>
  onAddEmptySpace: () => Promise<boolean>
  onCloneRepo: (repoUrl: string, parentDir?: string) => Promise<{ success: boolean; error?: string; parentDir?: string | null; authRequired?: boolean }>
  onRenameSpace: (spaceId: string, name: string) => void
  onDeleteSpace: (spaceId: string) => void
  onOpenSpaceInExplorer: (spaceId: string) => Promise<boolean>
  onSelectTab: (spaceId: string, tabId: string) => void
  onReorderTabs: (spaceId: string, sourceTabId: string, targetTabId: string) => void
  onCloseTab: (spaceId: string, tabId: string) => void
  onAddTab: (spaceId: string, type: AppTabType) => void
  onRenameTab: (spaceId: string, tabId: string, title: string) => void
}

type SpaceMenuState = {
  spaceId: string
  x: number
  y: number
}

type AddSpaceMenuState = {
  y: number
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
    return <img className="w-[16px] h-[16px] rounded-[4px] shrink-0" src={tab.faviconUrl} alt="" />
  }

  return getIcon(tab.type)
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
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
  onActivateSpace,
  onAddSpaceFromFolder,
  onAddEmptySpace,
  onCloneRepo,
  onRenameSpace,
  onDeleteSpace,
  onOpenSpaceInExplorer,
  onSelectTab,
  onReorderTabs,
  onCloseTab,
  onAddTab,
  onRenameTab,
}: Props) {
  const [collapsedSpaceIds, setCollapsedSpaceIds] = useState<string[]>([])
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
  const existingSpaceIds = useMemo(() => new Set(spaces.map((space) => space.id)), [spaces])
  const visibleSpaceMenu = spaceMenu && existingSpaceIds.has(spaceMenu.spaceId) ? spaceMenu : null
  const visibleSpaceMenuSpace = visibleSpaceMenu ? spaces.find((entry) => entry.id === visibleSpaceMenu.spaceId) ?? null : null
  const visibleEditingSpace = editingSpace && existingSpaceIds.has(editingSpace.spaceId) ? editingSpace : null

  const sidebarRef = useRef<HTMLElement | null>(null)
  const addSpaceButtonRef = useRef<HTMLButtonElement | null>(null)
  const spaceMenuRef = useRef<HTMLDivElement | null>(null)
  const addSpaceMenuRef = useRef<HTMLDivElement | null>(null)

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

  function toggleCollapsed(spaceId: string) {
    setCollapsedSpaceIds((current) =>
      current.includes(spaceId) ? current.filter((id) => id !== spaceId) : [...current, spaceId],
    )
  }

  function onTabDrop(spaceId: string, targetTabId: string) {
    if (!dragTabPayload || dragTabPayload.spaceId !== spaceId || dragTabPayload.tabId === targetTabId) {
      setDragTabPayload(null)
      return
    }

    onReorderTabs(spaceId, dragTabPayload.tabId, targetTabId)
    setDragTabPayload(null)
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
    window.dispatchEvent(new Event('opensmith:ui-interaction'))
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
      className="w-[292px] flex-shrink-0 flex flex-col pt-3 pb-3 px-3 gap-3 bg-black/26 backdrop-blur-2xl shadow-[inset_-1px_0_0_0_rgba(255,255,255,0.05)] relative"
      onMouseDownCapture={signalUiInteraction}
      onContextMenuCapture={signalUiInteraction}
    >
      <div className="flex items-center justify-between px-2">
        <div className="text-sm font-semibold text-[#d0d0d0] tracking-wide">OpenSmith</div>
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
          className={`absolute z-50 bg-[#141414]/90 backdrop-blur-xl border border-white/5 rounded-md shadow-2xl py-1.5 text-[12px] text-[#a3a3a3] ${cloneMode ? 'w-64' : 'w-48'}`}
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

      <div className="flex flex-col gap-1 px-1">
        <div className="text-[12px] font-medium text-[#7e7e7e] px-1">Projects</div>
      </div>

      <div className="flex flex-col gap-0.5 overflow-auto pr-1">
        {spaces.map((space) => {
          const isActive = space.id === activeSpaceId
          const isCollapsed = existingSpaceIds.has(space.id) && collapsedSpaceIds.includes(space.id)
          const activeSpaceTab = space.tabs.find((tab) => tab.id === space.activeTabId) ?? null
          const showCollapsedPreview = isActive && isCollapsed && Boolean(activeSpaceTab)
          const isGlobalSpace = (space.kind ?? 'project') === 'global'

          return (
            <div key={space.id} className="flex flex-col">
              <div className={`group relative w-full rounded-lg transition-colors ${isActive ? 'bg-white/10' : 'hover:bg-white/8'}`}>
                <button
                  className={`w-full text-[13px] px-2.5 pr-8 py-1.5 rounded-lg transition-colors flex items-center gap-2 font-medium cursor-pointer text-left ${isActive ? 'text-[#f1f1f1]' : 'text-[#b6b6b6]'}`}
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
                <div className="flex flex-col mt-1 mb-2 ml-4 pl-3 border-l border-white/12">
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
                </div>
              ) : null}

              {!isCollapsed ? (
                <div className="flex flex-col gap-0.5 mt-1 mb-2 ml-4 pl-3 border-l border-white/12">
                  {space.tabs.map((tab) => (
                    <div
                      key={tab.id}
                      className="flex items-center relative group"
                      draggable={false}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => onTabDrop(space.id, tab.id)}
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
                          className={`flex-1 flex items-center gap-2 px-2.5 py-1.5 text-[12.5px] rounded-md transition-colors text-left truncate ${isActive && space.activeTabId === tab.id ? 'text-[#e9e9e9] bg-white/12' : 'text-[#9a9a9a] hover:text-[#d7d7d7] hover:bg-white/8'}`}
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
                          <span className="truncate">{tab.title}</span>
                        </button>
                      )}

                      <button
                        className="absolute right-1 p-1 rounded-md opacity-0 group-hover:opacity-100 hover:bg-white/12 text-[#9a9a9a] hover:text-white transition-all cursor-pointer"
                        onClick={() => onCloseTab(space.id, tab.id)}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M18 6L6 18M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}

                  <div className="flex flex-col gap-1 mt-1.5 px-1">
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

      {visibleSpaceMenu ? (
        <div
          ref={spaceMenuRef}
          className="absolute z-50 bg-[#141414]/90 backdrop-blur-xl border border-white/5 rounded-md shadow-2xl py-1.5 w-48 text-[12px] text-[#a3a3a3]"
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
