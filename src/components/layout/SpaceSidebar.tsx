import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { AppSpace, AppTab, AppTabType } from '../../types/opensmith'

type Props = {
  spaces: AppSpace[]
  activeSpaceId: string | null
  activeSpace: AppSpace | null
  onActivateSpace: (spaceId: string) => void
  onAddSpace: () => void
  onSelectTab: (spaceId: string, tabId: string) => void
  onReorderTabs: (spaceId: string, sourceTabId: string, targetTabId: string) => void
  onCloseTab: (spaceId: string, tabId: string) => void
  onAddTab: (spaceId: string, type: AppTabType) => void
  onRenameTab: (spaceId: string, tabId: string, title: string) => void
}

function defaultTabTitle(type: AppTabType) {
  if (type === 'ai') return 'AI Chat'
  if (type === 'browser') return 'Browser'
  if (type === 'terminal') return 'Terminal'
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

function getIcon(type: AppTabType) {
  switch (type) {
    case 'ai':
      return (
        <svg className="w-[16px] h-[16px] text-[#969696]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
        </svg>
      )
    case 'browser':
      return (
        <svg className="w-[16px] h-[16px] text-[#969696]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /><path d="M2 12h20" />
        </svg>
      )
    case 'terminal':
      return (
        <svg className="w-[16px] h-[16px] text-[#969696]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line>
        </svg>
      )
    case 'editor':
      return (
        <svg className="w-[16px] h-[16px] text-[#969696]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline>
        </svg>
      )
  }
}

function AISparkleGlyph({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
    </svg>
  )
}

function renderTabIcon(tab: AppTab) {
  if (tab.type === 'ai') {

    const icon = (
      <span className="relative inline-flex h-[16px] w-[16px] items-center justify-center shrink-0">
        {tab.isGenerating ? <Loader2 className="absolute h-[14px] w-[14px] animate-spin text-[#d8d8d8]" /> : null}
        {!tab.isGenerating ? <AISparkleGlyph className={`h-[16px] w-[16px] text-[#969696]`} /> : null}
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

export function SpaceSidebar({
  spaces,
  activeSpaceId,
  activeSpace: _activeSpace,
  onActivateSpace,
  onAddSpace,
  onSelectTab,
  onReorderTabs,
  onCloseTab,
  onAddTab,
  onRenameTab,
}: Props) {
  const [collapsedSpaceIds, setCollapsedSpaceIds] = useState<string[]>([])
  const [dragTabPayload, setDragTabPayload] = useState<{ spaceId: string; tabId: string } | null>(null)
  const [editingTab, setEditingTab] = useState<{ spaceId: string; tabId: string; value: string } | null>(null)

  useEffect(() => {
    const existing = new Set(spaces.map((space) => space.id))
    setCollapsedSpaceIds((current) => current.filter((id) => existing.has(id)))
  }, [spaces])

  function toggleCollapsed(spaceId: string) {
    setCollapsedSpaceIds((current) =>
      current.includes(spaceId) ? current.filter((id) => id !== spaceId) : [...current, spaceId],
    )
  }

  function handleSpaceClick(spaceId: string) {
    toggleCollapsed(spaceId)
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

  function signalUiInteraction() {
    window.dispatchEvent(new Event('opensmith:ui-interaction'))
  }

  return (
    <aside
      className="w-[292px] flex-shrink-0 flex flex-col pt-3 pb-3 px-3 gap-3 bg-black/26 backdrop-blur-2xl shadow-[inset_-1px_0_0_0_rgba(255,255,255,0.05)]"
      onMouseDownCapture={signalUiInteraction}
      onContextMenuCapture={signalUiInteraction}
    >
      <div className="flex items-center justify-between px-2">
        <div className="text-sm font-semibold text-[#d0d0d0] tracking-wide">OpenSmith</div>
        <button className="text-[12px] text-[#9a9a9a] hover:text-[#e0e0e0] px-2 py-1 rounded-md cursor-pointer transition-colors hover:bg-white/8 outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0" onClick={onAddSpace}>
          Add Space
        </button>
      </div>

      <div className="flex flex-col gap-1 px-1">
        <div className="text-[12px] font-medium text-[#7e7e7e] px-1">Projects</div>
      </div>

      <div className="flex flex-col gap-0.5 overflow-auto pr-1">
        {spaces.map((space) => {
          const isActive = space.id === activeSpaceId
          const isCollapsed = collapsedSpaceIds.includes(space.id)
          const activeSpaceTab = space.tabs.find((tab) => tab.id === space.activeTabId) ?? null
          const showCollapsedPreview = isActive && isCollapsed && Boolean(activeSpaceTab)

          return (
          <div key={space.id} className="flex flex-col">
            <button
              className={`w-full text-[13px] px-2.5 py-1.5 rounded-lg transition-colors flex items-center gap-2 font-medium cursor-pointer text-left ${isActive ? 'text-[#f1f1f1] bg-white/10' : 'text-[#b6b6b6] hover:bg-white/8'}`}
              onClick={() => handleSpaceClick(space.id)}
            >
              <span className={isActive ? 'text-[#d8d8d8]' : 'text-[#969696]'}>
                <SpaceFolderIcon collapsed={isCollapsed} withPinned={showCollapsedPreview} />
              </span>
              <span>{space.name}</span>
            </button>

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

            {!isCollapsed && (
              <div className="flex flex-col gap-0.5 mt-1 mb-2 ml-4 pl-3 border-l border-white/12">
                {space.tabs.map((tab) => (
                  <div
                    key={tab.id}
                    className="flex items-center relative group"
                    draggable={editingTab?.tabId !== tab.id}
                    onDragStart={() => setDragTabPayload({ spaceId: space.id, tabId: tab.id })}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => onTabDrop(space.id, tab.id)}
                    onDragEnd={() => setDragTabPayload(null)}
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
                    <button className="absolute right-1 p-1 rounded-md opacity-0 group-hover:opacity-100 hover:bg-white/12 text-[#9a9a9a] hover:text-white transition-all cursor-pointer" onClick={() => onCloseTab(space.id, tab.id)}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M18 6L6 18M6 6l12 12"/>
                      </svg>
                    </button>
                  </div>
                ))}
                
                <div className="flex flex-col gap-1 mt-1.5 px-1">
                  <div className="text-[11px] text-[#7b7b7b] px-2">New Tab</div>
                  <div className="flex gap-1 pl-2">
                    <button className="text-xs text-[#7f7f7f] hover:text-[#dfdfdf] p-1.5 rounded-md hover:bg-white/10 transition-colors cursor-pointer flex items-center gap-1.5" onClick={() => onAddTab(space.id, 'ai')} title="AI Chat">
                      {getIcon('ai')}
                    </button>
                    <button className="text-xs text-[#7f7f7f] hover:text-[#dfdfdf] p-1.5 rounded-md hover:bg-white/10 transition-colors cursor-pointer flex items-center gap-1.5" onClick={() => onAddTab(space.id, 'browser')} title="Browser">
                      {getIcon('browser')}
                    </button>
                    <button className="text-xs text-[#7f7f7f] hover:text-[#dfdfdf] p-1.5 rounded-md hover:bg-white/10 transition-colors cursor-pointer flex items-center gap-1.5" onClick={() => onAddTab(space.id, 'terminal')} title="Terminal">
                      {getIcon('terminal')}
                    </button>
                    <button className="text-xs text-[#7f7f7f] hover:text-[#dfdfdf] p-1.5 rounded-md hover:bg-white/10 transition-colors cursor-pointer flex items-center gap-1.5" onClick={() => onAddTab(space.id, 'editor')} title="Editor">
                      {getIcon('editor')}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
          )
        })}
      </div>
    </aside>
  )
}
