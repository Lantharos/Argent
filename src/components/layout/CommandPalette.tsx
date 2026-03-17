import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  ArrowDown,
  ArrowUp,
  CornerDownLeft,
  FileCode2,
  FolderOpen,
  GitBranch,
  Globe,
  Plus,
  Search,
  Sparkles,
  TerminalSquare,
  X,
} from 'lucide-react'
import type { AppSpace, AppTab, AppTabType } from '../../types/opensmith'

type CommandPaletteItem = {
  id: string
  title: string
  subtitle: string
  section: string
  icon: 'search' | 'browser' | 'ai' | 'terminal' | 'editor' | 'git' | 'tab' | 'space' | 'new'
  hint?: string
  run: () => void
}

type Props = {
  spaces: AppSpace[]
  activeSpaceId: string | null
  onCreateTab: (spaceId: string, tabType: AppTabType, patch?: Partial<AppTab>) => void
  onSelectTab: (spaceId: string, tabId: string) => void
  onAddSpaceFromFolder: () => Promise<boolean>
  onAddEmptySpace: () => Promise<boolean>
}

const EXIT_MS = 180

function looksLikeUrl(value: string) {
  const trimmed = value.trim()
  if (!trimmed) {
    return false
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return true
  }

  if (/\s/.test(trimmed)) {
    return false
  }

  return /\./.test(trimmed) || /^localhost(?::\d+)?$/i.test(trimmed) || /^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?$/.test(trimmed)
}

function resolveBrowserTarget(rawInput: string) {
  const value = rawInput.trim()
  if (!value) {
    return { url: 'https://www.google.com', direct: true }
  }

  if (/^https?:\/\//i.test(value)) {
    try {
      const parsed = new URL(value)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return { url: parsed.toString(), direct: true }
      }
    } catch {
      return { url: `https://www.google.com/search?q=${encodeURIComponent(value)}`, direct: false }
    }
  }

  if (!/\s/.test(value) && (/\./.test(value) || /^localhost(?::\d+)?$/i.test(value) || /^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?$/.test(value))) {
    const protocol = /^localhost(?::\d+)?$/i.test(value) || /^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?$/.test(value) ? 'http://' : 'https://'
    const candidate = `${protocol}${value}`
    try {
      const parsed = new URL(candidate)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return { url: parsed.toString(), direct: true }
      }
    } catch {
      return { url: `https://www.google.com/search?q=${encodeURIComponent(value)}`, direct: false }
    }
  }

  return { url: `https://www.google.com/search?q=${encodeURIComponent(value)}`, direct: false }
}

function summarizeAiTitle(input: string) {
  const normalized = input.replace(/\s+/g, ' ').trim()
  if (!normalized) {
    return 'AI Chat'
  }
  return normalized.length > 36 ? `${normalized.slice(0, 36).trimEnd()}...` : normalized
}

function formatTabType(type: AppTabType) {
  if (type === 'ai') return 'AI'
  if (type === 'browser') return 'Browser'
  if (type === 'terminal') return 'Terminal'
  if (type === 'editor') return 'Editor'
  return 'Git'
}

function getIcon(icon: CommandPaletteItem['icon']) {
  if (icon === 'browser') return <Globe className="h-[15px] w-[15px]" />
  if (icon === 'ai') return <Sparkles className="h-[15px] w-[15px]" />
  if (icon === 'terminal') return <TerminalSquare className="h-[15px] w-[15px]" />
  if (icon === 'editor') return <FileCode2 className="h-[15px] w-[15px]" />
  if (icon === 'git') return <GitBranch className="h-[15px] w-[15px]" />
  if (icon === 'space') return <FolderOpen className="h-[15px] w-[15px]" />
  if (icon === 'new') return <Plus className="h-[15px] w-[15px]" />
  return <Search className="h-[15px] w-[15px]" />
}

export function CommandPalette({ spaces, activeSpaceId, onCreateTab, onSelectTab, onAddSpaceFromFolder, onAddEmptySpace }: Props) {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const deferredQuery = useDeferredValue(query)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const closeTimerRef = useRef<number | null>(null)
  const activeSpace = useMemo(() => spaces.find((space) => space.id === activeSpaceId) ?? null, [activeSpaceId, spaces])

  function openPalette() {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
    setOpen(true)
    setMounted(true)
    window.requestAnimationFrame(() => setVisible(true))
  }

  function closePalette() {
    setOpen(false)
    setVisible(false)
    setQuery('')
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
    }
    closeTimerRef.current = window.setTimeout(() => {
      setMounted(false)
      closeTimerRef.current = null
    }, EXIT_MS)
  }

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && ['t', 'k', 'p'].includes(event.key.toLowerCase())) {
        event.preventDefault()
        openPalette()
        return
      }

      if (event.key === 'Escape' && open) {
        event.preventDefault()
        closePalette()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open])

  useEffect(() => {
    return window.opensmith.app.onOpenCommandPalette(() => {
      openPalette()
    })
  }, [])

  useEffect(() => {
    if (!mounted) {
      setActiveIndex(0)
      return
    }

    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })

    return () => window.cancelAnimationFrame(frame)
  }, [mounted])

  useEffect(() => {
    setActiveIndex(0)
  }, [deferredQuery])

  const items = useMemo<CommandPaletteItem[]>(() => {
    const currentQuery = deferredQuery.trim()
    const normalizedQuery = currentQuery.toLowerCase()
    const nextItems: CommandPaletteItem[] = []
    const canUseProjectTools = activeSpace ? (activeSpace.kind ?? 'project') !== 'global' : false

    const pushIfMatches = (item: CommandPaletteItem, matches?: string[]) => {
      if (!normalizedQuery) {
        nextItems.push(item)
        return
      }

      const haystack = [item.title, item.subtitle, ...(matches ?? [])].join(' ').toLowerCase()
      if (haystack.includes(normalizedQuery)) {
        nextItems.push(item)
      }
    }

    if (activeSpace) {
      pushIfMatches({
        id: 'new-browser',
        title: currentQuery ? (looksLikeUrl(currentQuery) ? `Go to ${currentQuery}` : `Search web for "${currentQuery}"`) : 'New browser tab',
        subtitle: currentQuery ? 'Open this in a fresh browser tab' : 'Open a clean browser tab in the current space',
        section: 'Create',
        icon: 'browser',
        hint: 'Ctrl T',
        run: () => {
          const target = resolveBrowserTarget(currentQuery)
          onCreateTab(activeSpace.id, 'browser', {
            title: target.direct ? 'Browser' : currentQuery || 'Browser',
            url: target.url,
            faviconUrl: null,
          } as Partial<AppTab>)
          closePalette()
        },
      }, ['browser search web go to url address open site'])

      pushIfMatches({
        id: 'new-ai',
        title: currentQuery ? `Ask AI about "${currentQuery}"` : 'New AI chat',
        subtitle: currentQuery ? 'Open a fresh AI tab with this prompt ready to send' : 'Start a new AI conversation',
        section: 'Create',
        icon: 'ai',
        run: () => {
          onCreateTab(activeSpace.id, 'ai', currentQuery ? {
            title: summarizeAiTitle(currentQuery),
            input: currentQuery,
          } as Partial<AppTab> : undefined)
          closePalette()
        },
      }, ['chat ai assistant prompt ask model'])

      pushIfMatches({
        id: 'new-terminal',
        title: 'New terminal',
        subtitle: 'Open a terminal in this space',
        section: 'Create',
        icon: 'terminal',
        run: () => {
          onCreateTab(activeSpace.id, 'terminal')
          closePalette()
        },
      }, ['shell console command line'])

      if (canUseProjectTools) {
        pushIfMatches({
          id: 'new-editor',
          title: 'New code editor',
          subtitle: 'Open an empty editor tab',
          section: 'Create',
          icon: 'editor',
          run: () => {
            onCreateTab(activeSpace.id, 'editor')
            closePalette()
          },
        }, ['file code edit'])

        pushIfMatches({
          id: 'new-git',
          title: 'New git tab',
          subtitle: 'Open source control tools for this project',
          section: 'Create',
          icon: 'git',
          run: () => {
            onCreateTab(activeSpace.id, 'git')
            closePalette()
          },
        }, ['source control branch commit repo'])
      }
    } else {
      pushIfMatches({
        id: 'open-space',
        title: 'Open folder as a space',
        subtitle: 'Pick a project folder and create a workspace',
        section: 'Spaces',
        icon: 'space',
        run: () => {
          void onAddSpaceFromFolder().then((added) => {
            if (added) {
              closePalette()
            }
          })
        },
      }, ['project workspace folder open'])

      pushIfMatches({
        id: 'empty-space',
        title: 'Create empty space',
        subtitle: 'Start with a global space for browsing and AI',
        section: 'Spaces',
        icon: 'new',
        run: () => {
          void onAddEmptySpace().then((added) => {
            if (added) {
              closePalette()
            }
          })
        },
      }, ['global empty space'])
    }

    for (const space of spaces) {
      for (const tab of space.tabs) {
        pushIfMatches({
          id: `tab-${space.id}-${tab.id}`,
          title: tab.title,
          subtitle: `${space.name} · ${formatTabType(tab.type)}`,
          section: 'Switch To',
          icon: tab.type === 'browser' ? 'browser' : tab.type === 'ai' ? 'ai' : tab.type,
          hint: space.activeTabId === tab.id && activeSpaceId === space.id ? 'Active' : undefined,
          run: () => {
            onSelectTab(space.id, tab.id)
            closePalette()
          },
        }, [space.name, tab.type, tab.type === 'browser' ? tab.url : ''])
      }
    }

    return nextItems.slice(0, 24)
  }, [activeSpace, activeSpaceId, deferredQuery, onAddEmptySpace, onAddSpaceFromFolder, onCreateTab, onSelectTab, spaces])

  useEffect(() => {
    if (!mounted) {
      return
    }

    const activeElement = listRef.current?.querySelector<HTMLElement>(`[data-command-index="${activeIndex}"]`)
    activeElement?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, items, mounted])

  const groupedItems = useMemo(() => {
    const groups = new Map<string, CommandPaletteItem[]>()
    for (const item of items) {
      if (!groups.has(item.section)) {
        groups.set(item.section, [])
      }
      groups.get(item.section)?.push(item)
    }
    return Array.from(groups.entries())
  }, [items])

  function onInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((current) => (items.length === 0 ? 0 : (current + 1) % items.length))
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((current) => (items.length === 0 ? 0 : (current - 1 + items.length) % items.length))
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      items[activeIndex]?.run()
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      closePalette()
    }
  }

  if (!mounted) {
    return null
  }

  return (
    <div
      className={`fixed inset-0 z-[200] flex items-start justify-center px-5 pt-[11vh] [-webkit-app-region:no-drag] transition-all duration-200 ease-out ${
        visible
          ? 'bg-black/58 backdrop-blur-[6px]'
          : 'pointer-events-none bg-black/0 backdrop-blur-0'
      }`}
      onMouseDown={(event) => event.target === event.currentTarget && closePalette()}
    >
      <div
        className={`w-full max-w-[760px] overflow-hidden rounded-[18px] border border-white/10 bg-[#111111]/96 shadow-[0_28px_80px_rgba(0,0,0,0.48)] [-webkit-app-region:no-drag] transition-all duration-200 ease-out ${
          visible
            ? 'translate-y-0 scale-100 opacity-100'
            : '-translate-y-3 scale-[0.985] opacity-0'
        }`}
      >
        <div className="border-b border-white/8 px-3 pb-3 pt-3">
          <div className="flex items-center gap-3 rounded-xl bg-white/[0.03] px-4 py-3 transition-colors focus-within:bg-white/[0.05]">
            <Search className="h-4 w-4 shrink-0 text-[#7f7f7f]" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onInputKeyDown}
              className="flex-1 border-0 bg-transparent text-[14px] text-[#e7e7e7] outline-none placeholder:text-[#7d7d7d] [-webkit-app-region:no-drag]"
              placeholder="Search tabs, ask AI, open a site, or create a new tool"
              spellCheck={false}
            />
            <button
              className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] text-[#7f7f7f] transition-colors hover:bg-white/8 hover:text-[#dfdfdf]"
              onClick={closePalette}
              aria-label="Close command palette"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div ref={listRef} className="max-h-[58vh] overflow-auto px-3 py-2">
          {items.length > 0 ? (
            groupedItems.map(([section, sectionItems]) => (
              <div key={section} className="mb-3">
                <div className="px-2 pb-1.5 pt-1 text-[12px] font-medium text-[#7a7a7a]">
                  {section}
                </div>
                <div className="grid gap-1">
                  {sectionItems.map((item) => {
                    const index = items.findIndex((entry) => entry.id === item.id)
                    const active = index === activeIndex

                    return (
                      <button
                        key={item.id}
                        data-command-index={index}
                        className={`group flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-all duration-150 ${
                          active
                            ? 'bg-white/[0.07] text-[#ededed]'
                            : 'bg-transparent text-[#cfcfcf] hover:bg-white/[0.04]'
                        }`}
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => item.run()}
                      >
                        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-[8px] transition-colors ${
                          active
                            ? 'bg-white/[0.08] text-[#d8d8d8]'
                            : 'bg-white/[0.04] text-[#9a9a9a] group-hover:bg-white/[0.06] group-hover:text-[#cfcfcf]'
                        }`}>
                          {getIcon(item.icon)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13.5px] font-medium">{item.title}</span>
                          <span className="mt-0.5 block truncate text-[12px] text-[#8d8d8d]">{item.subtitle}</span>
                        </span>
                        {item.hint ? (
                          <span className="shrink-0 rounded-[8px] bg-white/[0.05] px-2.5 py-1 text-[10px] font-medium text-[#8d8d8d]">
                            {item.hint}
                          </span>
                        ) : null}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))
          ) : (
            <div className="grid min-h-[260px] place-items-center px-5 py-5 text-center">
              <div>
                <div className="text-[15px] font-medium text-[#e5e5e5]">Nothing matching yet</div>
                <div className="mt-2 max-w-[360px] text-[12.5px] leading-6 text-[#8b8b8b]">
                  Try a tab name, a URL, or something like "terminal" or "ask AI about auth".
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-white/8 px-3 py-3">
          <span className="inline-flex items-center gap-1.5 rounded-[8px] bg-white/[0.04] px-2.5 py-1.5 text-[11px] text-[#8d8d8d]">
            <ArrowUp className="h-3 w-3" />
            <ArrowDown className="h-3 w-3" />
            Move
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-[8px] bg-white/[0.04] px-2.5 py-1.5 text-[11px] text-[#8d8d8d]">
            <CornerDownLeft className="h-3 w-3" />
            Open
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-[8px] bg-white/[0.04] px-2.5 py-1.5 text-[11px] text-[#8d8d8d]">
            Esc Close
          </span>
        </div>
      </div>
    </div>
  )
}
