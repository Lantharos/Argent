import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import {
  ChevronDown,
  CircleDot,
  FileText,
  Monitor,
  PencilLine,
  SendHorizontal,
  TerminalSquare,
  TriangleAlert,
  Plus,
  Loader2
} from 'lucide-react'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import type { AITabData, AIStreamEvent, ProviderConfig } from '../../types/opensmith'

type Props = {
  tab: AITabData
  cwd: string
  providers: ProviderConfig[]
  onChange: (next: AITabData) => void
  onSend: (
    providerId: string,
    messages: { role: 'user' | 'assistant'; content: string }[],
    cwd?: string,
    model?: string,
  ) => Promise<string>
}

type ModelOption = { id: string; label: string; contextWindow?: number | null }

const EFFORT_ORDER = ['base', 'thinking', 'low', 'medium', 'high', 'xhigh'] as const

type EffortLevel = (typeof EFFORT_ORDER)[number]

type ModelFamily = {
  group: string
  name: string
  key: string
  variants: Array<ModelOption & { effort: EffortLevel }>
}

function parseModelVariant(option: ModelOption) {
  const label = (option.label || option.id).trim()

  const parenthetical = label.match(/^(.*)\((thinking|low|medium|high|xhigh)\)\s*$/i)
  if (parenthetical) {
    return {
      baseLabel: parenthetical[1].trim(),
      effort: parenthetical[2].toLowerCase() as EffortLevel,
    }
  }

  const suffix = label.match(/^(.*?)-(thinking|low|medium|high|xhigh)\s*$/i)
  if (suffix) {
    return {
      baseLabel: suffix[1].trim(),
      effort: suffix[2].toLowerCase() as EffortLevel,
    }
  }

  return {
    baseLabel: label,
    effort: 'base' as EffortLevel,
  }
}

function effortLabel(effort: EffortLevel) {
  if (effort === 'base') return 'Base'
  if (effort === 'xhigh') return 'X-High'
  return effort[0].toUpperCase() + effort.slice(1)
}

function splitModelOption(option: ModelOption) {
  const label = option.label || option.id
  const slashIndex = label.indexOf('/')
  if (slashIndex > 0) {
    return {
      group: label.slice(0, slashIndex).trim(),
      name: label.slice(slashIndex + 1).trim(),
    }
  }

  const idParts = option.id.split('/')
  if (idParts.length > 1) {
    return {
      group: idParts[0],
      name: idParts.slice(1).join('/'),
    }
  }

  return {
    group: 'Models',
    name: label,
  }
}

function normalizeMarkdownSpacing(content: string) {
  return content.replace(/\r\n/g, '\n')
}

function toolStatusLabel(status: string) {
  if (status === 'pending') return 'Pending'
  if (status === 'in_progress') return 'Running'
  if (status === 'completed') return 'Done'
  if (status === 'failed') return 'Failed'
  return status
}

function toolKindIcon(kind: string) {
  if (kind === 'edit') {
    return <PencilLine className="h-3.5 w-3.5" />
  }
  if (kind === 'execute' || kind === 'commandExecution') {
    return <TerminalSquare className="h-3.5 w-3.5" />
  }
  if (kind === 'read') {
    return <FileText className="h-3.5 w-3.5" />
  }
  return <CircleDot className="h-3.5 w-3.5" />
}

function formatToolMessage(title: string, status: string, kind = 'other', detail?: string | null) {
  const encodedDetail = detail ? encodeURIComponent(detail) : ''
  return `[[tool]]${encodeURIComponent(title)}::${status}::${kind}::${encodedDetail}`
}

function parseToolMessage(content: string) {
  if (!content.startsWith('[[tool]]')) {
    return null
  }

  const raw = content.slice('[[tool]]'.length)
  const parts = raw.split('::')
  if (parts.length < 2) {
    return null
  }

  const encodedTitle = parts[0]
  const status = parts[1]
  const kind = parts[2] || 'other'
  const encodedDetail = parts[3] || ''

  let title = encodedTitle
  try {
    title = decodeURIComponent(encodedTitle)
  } catch {
    title = encodedTitle
  }

  let detail: string | null = null
  if (encodedDetail) {
    try {
      detail = decodeURIComponent(encodedDetail)
    } catch {
      detail = encodedDetail
    }
  }

  return {
    title,
    status,
    kind,
    detail,
  }
}

function compactConversation(messages: { role: 'user' | 'assistant'; content: string }[]) {
  if (messages.length <= 12) {
    return messages
  }

  const tail = messages.slice(-10)
  const head = messages.slice(0, -10)

  const summary = head
    .filter((msg) => msg.content.trim().length > 0)
    .slice(-8)
    .map((msg) => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content.replace(/\s+/g, ' ').trim()}`)
    .join('\n')

  if (!summary) {
    return tail
  }

  return [
    { role: 'user' as const, content: 'Previous conversation summary:' },
    { role: 'assistant' as const, content: summary.length > 2200 ? `${summary.slice(0, 2200)}...` : summary },
    ...tail,
  ]
}

function summarizeTabTitleFromPrompt(input: string) {
  const normalized = input.replace(/\s+/g, ' ').trim()
  if (!normalized) {
    return 'AI Chat'
  }

  const firstLine = normalized.split('\n')[0]?.trim() || normalized
  const base = firstLine.length > 42 ? `${firstLine.slice(0, 42).trimEnd()}...` : firstLine
  return base || 'AI Chat'
}

function formatContextWindow(value: number | null) {
  if (value == null || !Number.isFinite(value)) {
    return null
  }
  if (value >= 1_000_000) {
    return `${Math.round(value / 100_000) / 10}M ctx`
  }
  if (value >= 1_000) {
    return `${Math.round(value / 100) / 10}k ctx`
  }
  return `${value} ctx`
}

export function AITab({ tab, cwd, providers, onChange, onSend }: Props) {
  const [loading, setLoading] = useState(false)
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [activeMetaPopover, setActiveMetaPopover] = useState<'local' | 'access' | null>(null)
  const modelMenuRef = useRef<HTMLDivElement | null>(null)

  const [modelOptions, setModelOptions] = useState<ModelOption[]>([])
  const modelOptionsCacheRef = useRef<Record<string, ModelOption[]>>({})
  const modelLoadTokenRef = useRef(0)
  const [modelFilter, setModelFilter] = useState('')
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})

  const activeRequestIdRef = useRef<string | null>(null)
  const toolMessageIndexByIdRef = useRef<Record<string, number>>({})
  const tabRef = useRef(tab)
  const onChangeRef = useRef(onChange)
  const scrollRef = useRef<HTMLDivElement>(null)
  const isAutoScrolling = useRef(true)

  useEffect(() => {
    tabRef.current = tab
  }, [tab])

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  const selectedProvider = useMemo<ProviderConfig | null>(
    () => providers.find((provider) => provider.id === 'opencode-acp') ?? null,
    [providers],
  )

  const opencodeInstalled = Boolean(selectedProvider)
  const selectedModelValue = tab.model || selectedProvider?.model || null

  const selectedModelLabel = useMemo(() => {
    const selectedOption = modelOptions.find((item) => item.id === selectedModelValue)
    if (selectedOption?.label) {
      return selectedOption.label
    }

    if (selectedProvider) {
      const cached = modelOptionsCacheRef.current[selectedProvider.id] ?? []
      const fromCache = cached.find((item) => item.id === selectedModelValue)?.label
      if (fromCache) {
        return fromCache
      }
    }

    return selectedModelValue || 'Select model'
  }, [modelOptions, selectedProvider, selectedModelValue])

  const groupedModelFamilies = useMemo(() => {
    const query = modelFilter.trim().toLowerCase()
    const map = new Map<string, ModelFamily>()

    for (const option of modelOptions) {
      const variant = parseModelVariant(option)
      const split = splitModelOption({ ...option, label: variant.baseLabel })
      const searchable = `${split.group} ${split.name} ${variant.effort} ${option.id}`.toLowerCase()
      if (query && !searchable.includes(query)) {
        continue
      }

      const key = `${split.group}::${split.name}`
      if (!map.has(key)) {
        map.set(key, {
          group: split.group,
          name: split.name,
          key,
          variants: [],
        })
      }

      map.get(key)?.variants.push({ ...option, effort: variant.effort })
    }

    const families = Array.from(map.values()).map((family) => ({
      ...family,
      variants: [...family.variants].sort((a, b) => {
        const aIndex = EFFORT_ORDER.indexOf(a.effort)
        const bIndex = EFFORT_ORDER.indexOf(b.effort)
        if (aIndex !== bIndex) {
          return aIndex - bIndex
        }
        return a.label.localeCompare(b.label)
      }),
    }))

    const grouped = new Map<string, ModelFamily[]>()
    for (const family of families) {
      if (!grouped.has(family.group)) {
        grouped.set(family.group, [])
      }
      grouped.get(family.group)?.push(family)
    }

    return Array.from(grouped.entries())
      .map(([group, familiesInGroup]) => ({
        group,
        families: [...familiesInGroup].sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.group.localeCompare(b.group))
  }, [modelOptions, modelFilter])

  const selectedModelContextWindow = useMemo(() => {
    const direct = modelOptions.find((item) => item.id === selectedModelValue)?.contextWindow
    if (typeof direct === 'number' && Number.isFinite(direct)) {
      return direct
    }

    if (selectedProvider) {
      const cached = modelOptionsCacheRef.current[selectedProvider.id] ?? []
      const fromCache = cached.find((item) => item.id === selectedModelValue)?.contextWindow
      if (typeof fromCache === 'number' && Number.isFinite(fromCache)) {
        return fromCache
      }
    }

    return null
  }, [modelOptions, selectedProvider, selectedModelValue])

  useEffect(() => {
    setCollapsedGroups((prev) => {
      const next: Record<string, boolean> = {}
      for (const section of groupedModelFamilies) {
        next[section.group] = prev[section.group] ?? false
      }
      return next
    })
  }, [groupedModelFamilies])

  const lastAssistantTextIndex = useMemo(() => {
    if (tab.messages.length === 0) {
      return -1
    }

    const lastIndex = tab.messages.length - 1
    const lastMessage = tab.messages[lastIndex]
    
    if (lastMessage.role === 'assistant' && !parseToolMessage(lastMessage.content)) {
      return lastIndex
    }

    return -1
  }, [tab.messages])

  const updateTab = useCallback((updater: (current: AITabData) => AITabData) => {
    const next = updater(tabRef.current)
    tabRef.current = next
    onChangeRef.current(next)
  }, [])

  useEffect(() => {
    if (isAutoScrolling.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [tab.messages, loading])

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current
    isAutoScrolling.current = scrollHeight - scrollTop - clientHeight < 100
  }, [])

  const appendAssistantDelta = useCallback((delta: string) => {
    if (!delta) {
      return
    }

    updateTab((current) => {
      const messages = [...current.messages]
      const last = messages.at(-1)
      const isToolLine = last?.role === 'assistant' && typeof last?.content === 'string' && last.content.startsWith('[[tool]]')

      if (last && last.role === 'assistant' && !isToolLine) {
        messages[messages.length - 1] = {
          ...last,
          content: `${last.content}${delta}`,
        }
      } else {
        messages.push({ role: 'assistant', content: delta })
      }

      return {
        ...current,
        messages,
      }
    })
  }, [updateTab])

  const markdownComponents = useMemo<Components>(
    () => ({
      p: ({ children, ...props }) => (
        <p className="my-1.5 whitespace-pre-wrap leading-7 text-[#d2d2d2]" {...props}>
          {children}
        </p>
      ),
      ul: ({ children, ...props }) => (
        <ul className="my-2 list-disc pl-6 space-y-1 marker:text-[#d0d0d0]" {...props}>
          {children}
        </ul>
      ),
      ol: ({ children, ...props }) => (
        <ol className="my-2 list-decimal pl-6 space-y-1 marker:text-[#d0d0d0]" {...props}>
          {children}
        </ol>
      ),
      li: ({ children, ...props }) => (
        <li className="leading-7 text-[#d2d2d2] [&>p]:my-0" {...props}>
          {children}
        </li>
      ),
    }),
    [],
  )

  useEffect(() => {
    const unsubscribe = window.opensmith.ai.onStreamEvent((payload) => {
      if (payload.requestId !== activeRequestIdRef.current) {
        return
      }

      const event = payload.event as AIStreamEvent
      if (event.type === 'text-delta') {
        appendAssistantDelta(event.delta)
        return
      }

      if (event.type === 'tool') {
        const toolId = event.id || `${event.kind || 'tool'}:${event.title}`

        updateTab((current) => {
          const messages = [...current.messages]
          const existingIndex = toolMessageIndexByIdRef.current[toolId]
          const content = formatToolMessage(event.title, event.status, event.kind || 'other', event.detail)

          if (typeof existingIndex === 'number' && existingIndex >= 0 && existingIndex < messages.length) {
            messages[existingIndex] = {
              role: 'assistant',
              content,
            }
          } else {
            messages.push({
              role: 'assistant',
              content,
            })
            toolMessageIndexByIdRef.current[toolId] = messages.length - 1
          }

          return {
            ...current,
            messages,
          }
        })
        return
      }

      if (event.type === 'error') {
        activeRequestIdRef.current = null
        setLoading(false)

        updateTab((current) => {
          const messages = current.messages.map((msg) => {
            if (msg.role === 'assistant') {
              const tool = parseToolMessage(msg.content)
              if (tool && (tool.status === 'in_progress' || tool.status === 'pending')) {
                return { ...msg, content: formatToolMessage(tool.title, 'failed', tool.kind, tool.detail) }
              }
            }
            return msg
          })
          return { ...current, messages }
        })

        appendAssistantDelta(`\n\nError: ${event.message}`)
        return
      }

      if (event.type === 'done') {
        activeRequestIdRef.current = null
        setLoading(false)

        updateTab((current) => {
          const messages = current.messages.map((msg) => {
            if (msg.role === 'assistant') {
              const tool = parseToolMessage(msg.content)
              if (tool && (tool.status === 'in_progress' || tool.status === 'pending')) {
                return { ...msg, content: formatToolMessage(tool.title, 'completed', tool.kind, tool.detail) }
              }
            }
            return msg
          })
          return { ...current, messages }
        })

        const reply = event.reply
        const current = tabRef.current
        const last = current.messages.at(-1)
        if ((!last || last.role !== 'assistant' || !last.content.trim()) && reply.content) {
          appendAssistantDelta(reply.content)
        }
      }
    })

    return unsubscribe
  }, [appendAssistantDelta, updateTab])

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null
      if (!target) {
        return
      }
      if (modelMenuRef.current?.contains(target)) {
        return
      }
      setModelMenuOpen(false)
      setActiveMetaPopover(null)
    }

    window.addEventListener('pointerdown', handlePointerDown)
    return () => window.removeEventListener('pointerdown', handlePointerDown)
  }, [])

  useEffect(() => {
    async function loadModels() {
      if (!selectedProvider) {
        setModelOptions([])
        return
      }

      const providerId = selectedProvider.id
      const fallback = [{ id: selectedProvider.model, label: selectedProvider.model, contextWindow: null }]
      const cached = modelOptionsCacheRef.current[providerId]
      if (cached && cached.length > 0) {
        setModelOptions(cached)
      } else {
        setModelOptions(fallback)
      }

      const token = modelLoadTokenRef.current + 1
      modelLoadTokenRef.current = token

      let resolved = cached && cached.length > 0 ? cached : fallback
      try {
        const models = await window.opensmith.ai.listModels({ providerId, cwd })
        if (token !== modelLoadTokenRef.current) {
          return
        }

        if (models.length > 0) {
          resolved = models
          modelOptionsCacheRef.current[providerId] = models
          setModelOptions(models)
        }
      } catch {
        if (token !== modelLoadTokenRef.current) {
          return
        }
        setModelOptions(resolved)
      }

      const current = tabRef.current
      const currentModel = current.model || ''
      const hasCurrent = Boolean(currentModel) && resolved.some((item) => item.id === currentModel)
      const nextModel = hasCurrent ? currentModel : resolved[0]?.id || selectedProvider.model

      if (current.providerId !== providerId || current.model !== nextModel) {
        updateTab((prev) => ({
          ...prev,
          providerId,
          model: nextModel,
        }))
      }
    }

    void loadModels()
  }, [selectedProvider, cwd, updateTab])

  async function addFileContext() {
    const picked = await window.opensmith.fs.openFile(null)
    if (!picked) {
      return
    }
    const content = await window.opensmith.fs.readFile(picked)
    const name = picked.split(/[/\\]/).at(-1) ?? picked
    const block = `\n\n--- FILE: ${name} (${picked}) ---\n${content}\n--- END FILE ---\n`
    updateTab((current) => ({ ...current, input: `${current.input}${block}` }))
  }

  async function handleSend() {
    const current = tabRef.current
    const input = current.input.trim()
    const provider = selectedProvider

    if (!provider || input.length === 0 || loading) {
      return
    }

    const cleanMessages = current.messages.map((msg) => {
      if (msg.role === 'assistant') {
        const tool = parseToolMessage(msg.content)
        if (tool && (tool.status === 'in_progress' || tool.status === 'pending')) {
          return { ...msg, content: formatToolMessage(tool.title, 'completed', tool.kind, tool.detail) }
        }
      }
      return msg
    })

    const hasUserMessages = cleanMessages.some((msg) => msg.role === 'user' && msg.content.trim().length > 0)
    const shouldRetitle = !hasUserMessages && (current.title.trim().length === 0 || current.title === 'AI Chat')
    const nextTitle = shouldRetitle ? summarizeTabTitleFromPrompt(input) : current.title

    const withUser: AITabData['messages'] = [...cleanMessages, { role: 'user', content: input }]
    const compacted = compactConversation(
      withUser.filter(
        (msg): msg is { role: 'user' | 'assistant'; content: string } =>
          (msg.role === 'user' || msg.role === 'assistant') && msg.content.length > 0,
      ),
    )

    updateTab((prev) => ({
      ...prev,
      title: nextTitle,
      input: '',
      providerId: provider.id,
      messages: withUser,
    }))

    toolMessageIndexByIdRef.current = {}

    setLoading(true)
    isAutoScrolling.current = true

    try {
      const usable = compacted.filter(
        (msg): msg is { role: 'user' | 'assistant'; content: string } =>
          (msg.role === 'user' || msg.role === 'assistant') && msg.content.length > 0,
      )

      const streamStart = await window.opensmith.ai.streamStart({
        providerId: provider.id,
        messages: usable,
        cwd,
        model: current.model || provider.model,
      })

      activeRequestIdRef.current = streamStart.requestId
    } catch {
      try {
        const usable = compacted.filter(
          (msg): msg is { role: 'user' | 'assistant'; content: string } =>
            msg.role === 'user' || msg.role === 'assistant',
        )
        const content = await onSend(provider.id, usable, cwd, current.model || provider.model)

        updateTab((prev) => {
          const messages = [...prev.messages]
          if (messages.length > 0 && messages[messages.length - 1].role === 'assistant') {
            messages[messages.length - 1] = { role: 'assistant', content }
          } else {
            messages.push({ role: 'assistant', content })
          }
          return {
            ...prev,
            messages,
          }
        })
      } finally {
        setLoading(false)
      }
    }
  }

  return (
    <section className="tab-pane ai-tab relative">
      <div className="h-[52px] shrink-0" aria-hidden="true" />
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex flex-1 min-h-0 flex-col gap-3 overflow-auto px-5 md:px-12 lg:px-24 pt-5 pb-56 [-webkit-app-region:no-drag]"
      >
        {!opencodeInstalled ? (
          <div className="w-full max-w-[760px] mx-auto mt-8 rounded-2xl border border-[#3a2f21] bg-[#1a140e] px-4 py-3 text-[#d6b796]">
            <div className="text-[14px] font-semibold text-[#e8c89f]">OpenCode CLI required</div>
            <p className="mt-1 mb-0 text-[13px] text-[#d2b08a]">Install OpenCode CLI and ensure `opencode` is available in PATH. Then restart OpenSmith.</p>
            <p className="mt-1 mb-0 text-[12px] text-[#b8926f]">Command: `bun add -g opencode-ai` or your preferred install method from opencode.ai/docs.</p>
          </div>
        ) : null}

        {tab.messages.length === 0 ? (
          <div className="w-full max-w-[760px] mx-auto mt-10 md:mt-16 px-2 text-center">
            <h2 className="m-0 text-[30px] leading-tight font-semibold tracking-tight text-[#efefef]">What do you want to build?</h2>
            <p className="mt-3 mb-0 text-[14px] text-[#9a9a9a]">Describe an app, feature, bug fix, or refactor and I can plan and execute it.</p>
          </div>
        ) : null}

        {tab.messages.map((message, index) => (
          (() => {
            const parsedTool = message.role === 'assistant' ? parseToolMessage(message.content) : null
            const toolData = parsedTool ? {
              ...parsedTool,
              status: (!loading && (parsedTool.status === 'in_progress' || parsedTool.status === 'pending')) 
                ? 'completed' 
                : parsedTool.status
            } : null

            if (toolData) {
              return (
                <div key={index} className="mr-auto w-full max-w-full py-0.5">
                  <div className="flex max-w-full items-start gap-2.5 py-1 text-[13px]">
                    <span className="text-[#8bb4ff] flex shrink-0 items-center justify-center">
                      {toolKindIcon(toolData.kind)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[#cccccc]">{toolData.title}</div>
                      {toolData.detail ? <div className="truncate text-[11px] text-[#7d7d7d]">{toolData.detail}</div> : null}
                    </div>
                    <span className={`text-[12px] flex items-center gap-1.5 ${
                      toolData.status === 'failed' ? 'text-red-400' :
                      toolData.status === 'in_progress' ? 'text-blue-400' :
                      toolData.status === 'completed' ? 'text-[#878787]' :
                      'text-[#707070]'
                    }`}>
                      {toolData.status === 'in_progress' ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                      {toolStatusLabel(toolData.status)}
                    </span>
                  </div>
                </div>
              )
            }

            return (
          <div
            key={index}
            className={
              message.role === 'user'
                ? 'py-1 border-none ml-auto bg-white/12 shadow-sm ring-1 ring-white/10 rounded-2xl px-4 py-2.5 text-white max-w-[75%] whitespace-pre-wrap'
                : 'py-1 px-0 border-none mr-auto bg-transparent text-[#b6b6b6] w-full max-w-full'
            }
          >
            {message.role === 'assistant' ? (
              <div className="prose prose-invert max-w-none prose-p:my-2 prose-p:leading-7 prose-headings:my-2 prose-strong:text-[#efefef] prose-em:text-[#d6d6d6] prose-code:text-[#d9d9d9] prose-pre:bg-[#111111]/90 prose-pre:border prose-pre:border-white/10 prose-pre:rounded-xl prose-blockquote:border-l-white/25 prose-blockquote:text-[#c9c9c9] prose-table:my-3 prose-table:w-full prose-th:border prose-th:border-white/20 prose-th:px-2 prose-th:py-1 prose-td:border prose-td:border-white/15 prose-td:px-2 prose-td:py-1 prose-hr:border-white/15">
                <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={markdownComponents}>
                  {normalizeMarkdownSpacing(message.content || '')}
                </ReactMarkdown>
                {loading && index === lastAssistantTextIndex ? (
                  <span className="inline-block animate-pulse text-[#f0f0f0]">▌</span>
                ) : null}
              </div>
            ) : (
              message.content
            )}
          </div>
            )
          })()
        ))}

        {loading && lastAssistantTextIndex === -1 ? (
          <div className="py-1 px-0 border-none mr-auto bg-transparent text-[#b6b6b6] w-full max-w-full">
            <span className="inline-block animate-pulse text-[#f0f0f0]">▌</span>
          </div>
        ) : null}
      </div>

      <form
        className="absolute bottom-0 left-0 right-0 z-20 w-full px-5 md:px-12 lg:px-24 pb-5 [-webkit-app-region:no-drag]"
        onSubmit={(event) => {
          event.preventDefault()
          void handleSend()
        }}
      >
        <div
          className="flex flex-col w-full rounded-3xl border border-white/20 hover:border-white/30 focus-within:border-white/40 transition px-1 bg-[#101010]/74 backdrop-blur-xl backdrop-saturate-150 text-[#e5e5e5] shadow-[0_20px_55px_rgba(0,0,0,0.5)]"
          dir="auto"
        >
          <div className="px-2.5">
            <textarea
              className="w-full bg-transparent outline-none border-0 resize-none text-[15px] text-[#ebebeb] placeholder:text-[#7f7f7f] pt-2.5 pb-[6px] px-1 min-h-[72px] max-h-72 overflow-auto"
              value={tab.input}
              onChange={(event) => updateTab((current) => ({ ...current, input: event.target.value }))}
              placeholder={opencodeInstalled ? 'Ask OpenSmith anything, @ to add files, / for commands' : 'Install OpenCode CLI to enable AI chat'}
              rows={3}
            />
          </div>

          <div className="flex items-center justify-between mb-2.5 mx-1 border-t border-[#2c2c2c] pt-2">
            <div className="flex items-center gap-1.5">
              <button type="button" className="bg-transparent hover:bg-white/8 text-[#b8b8b8] transition rounded-full p-1.5 outline-none" onClick={addFileContext} aria-label="Add file">
                <Plus className="h-4 w-4" />
              </button>

              <div className="relative" ref={modelMenuRef}>
                <button
                  type="button"
                  className="rounded-lg border border-[#383838] bg-[#1a1a1a] px-2 py-1.5 text-sm text-[#d7d7d7] outline-none focus:border-[#5c5c5c] inline-flex items-center gap-1.5 min-w-[260px] justify-between"
                  onClick={() => setModelMenuOpen((prev) => !prev)}
                  aria-haspopup="listbox"
                  aria-expanded={modelMenuOpen}
                >
                  <span className="truncate">{selectedModelLabel}</span>
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>

                {modelMenuOpen ? (
                  <div className="absolute left-0 bottom-[calc(100%+8px)] w-[440px] max-w-[80vw] rounded-xl border border-[#363636] bg-[#181818] p-1.5 shadow-[0_16px_40px_rgba(0,0,0,0.45)] z-40" role="listbox">
                    <div className="p-1.5">
                      <input
                        className="w-full rounded-lg border border-[#343434] bg-[#151515] px-2.5 py-2 text-sm text-[#dddddd] outline-none focus:border-[#5c5c5c]"
                        placeholder="Search models"
                        value={modelFilter}
                        onChange={(event) => setModelFilter(event.target.value)}
                      />
                    </div>

                    <div className="max-h-[340px] overflow-auto px-1 pb-1">
                      {groupedModelFamilies.length === 0 ? (
                        <div className="px-3 py-2 text-xs text-[#888888]">No models found</div>
                      ) : (
                        groupedModelFamilies.map((section) => {
                          const isCollapsed = collapsedGroups[section.group] ?? false
                          return (
                            <div key={section.group} className="mb-1">
                              <button
                                type="button"
                                className="w-full text-left rounded-md px-2.5 py-2 text-xs font-semibold uppercase tracking-wider text-[#9f9f9f] bg-[#202020] hover:bg-[#272727] inline-flex items-center justify-between"
                                onClick={() => {
                                  setCollapsedGroups((prev) => ({
                                    ...prev,
                                    [section.group]: !isCollapsed,
                                  }))
                                }}
                              >
                                <span className="truncate">{section.group}</span>
                                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isCollapsed ? '-rotate-90' : ''}`} />
                              </button>

                              {!isCollapsed ? (
                                <div className="mt-1 grid gap-1">
                                  {section.families.map((family) => {
                                    const selectedVariant = family.variants.find((item) => item.id === selectedModelValue) || family.variants[0]
                                    return (
                                      <div
                                        key={family.key}
                                        className={`w-full rounded-lg px-3 py-2 text-sm transition-colors ${selectedVariant?.id === selectedModelValue ? 'bg-[#2f2f2f] text-[#efefef]' : 'text-[#c4c4c4] hover:bg-[#2a2a2a]'}`}
                                      >
                                        <div className="flex items-center justify-between gap-2">
                                          <button
                                            type="button"
                                            className="truncate text-left"
                                            onClick={() => {
                                              if (!selectedVariant) return
                                              updateTab((current) => ({ ...current, model: selectedVariant.id }))
                                              setModelMenuOpen(false)
                                            }}
                                          >
                                            {family.name}
                                          </button>

                                          {family.variants.length > 1 ? (
                                            <div className="flex items-center gap-1">
                                              {family.variants.map((variant) => (
                                                <button
                                                  key={variant.id}
                                                  type="button"
                                                  className={`rounded-md border px-1.5 py-0.5 text-[10px] ${selectedModelValue === variant.id ? 'border-[#6e6e6e] bg-[#3a3a3a] text-[#efefef]' : 'border-[#3d3d3d] bg-[#242424] text-[#9f9f9f] hover:bg-[#2b2b2b]'}`}
                                                  onClick={() => {
                                                    updateTab((current) => ({ ...current, model: variant.id }))
                                                  }}
                                                >
                                                  {effortLabel(variant.effort)}
                                                </button>
                                              ))}
                                            </div>
                                          ) : null}
                                        </div>
                                      </div>
                                    )
                                  })}
                                </div>
                              ) : null}
                            </div>
                          )
                        })
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              {formatContextWindow(selectedModelContextWindow) ? (
                <span className="text-xs text-[#b5b5b5] inline-flex items-center gap-1 rounded-full border border-[#3a3a3a] bg-[#1b1b1b] px-2 py-1">
                  {formatContextWindow(selectedModelContextWindow)}
                </span>
              ) : null}

              <div className="relative">
                <button
                  type="button"
                  className="text-xs text-[#959595] inline-flex items-center gap-1 rounded-full border border-[#3a3a3a] bg-[#1b1b1b] px-2 py-1 hover:bg-[#242424] transition-colors"
                  onClick={() => setActiveMetaPopover((prev) => (prev === 'local' ? null : 'local'))}
                >
                  <Monitor className="h-3.5 w-3.5" />
                  Local
                </button>
                {activeMetaPopover === 'local' ? (
                  <div className="absolute right-0 bottom-[calc(100%+8px)] w-[220px] rounded-xl border border-[#353535] bg-[#161616] px-3 py-2 text-[12px] leading-relaxed text-[#b9b9b9] shadow-[0_14px_30px_rgba(0,0,0,0.45)] z-40" role="status">
                    Uses files from the active workspace path only.
                  </div>
                ) : null}
              </div>

              <div className="relative">
                <button
                  type="button"
                  className="text-xs text-[#aaaaaa] inline-flex items-center gap-1 rounded-full border border-[#3a3a3a] bg-[#1b1b1b] px-2 py-1 hover:bg-[#242424] transition-colors"
                  onClick={() => setActiveMetaPopover((prev) => (prev === 'access' ? null : 'access'))}
                >
                  <TriangleAlert className="h-3.5 w-3.5" />
                  Full access
                </button>
                {activeMetaPopover === 'access' ? (
                  <div className="absolute right-0 bottom-[calc(100%+8px)] w-[220px] rounded-xl border border-[#353535] bg-[#161616] px-3 py-2 text-[12px] leading-relaxed text-[#b9b9b9] shadow-[0_14px_30px_rgba(0,0,0,0.45)] z-40" role="status">
                    Model tools can read and write files in this space.
                  </div>
                ) : null}
              </div>

              <button
                className="bg-[#b0b0b0] text-[#151515] hover:bg-[#c8c8c8] transition rounded-full size-9 flex items-center justify-center text-base font-semibold disabled:opacity-45 disabled:hover:bg-[#b0b0b0]"
                type="submit"
                disabled={loading || !opencodeInstalled || tab.input.trim().length === 0}
              >
                {loading ? (
                  <CircleDot className="h-4 w-4 animate-pulse" />
                ) : (
                  <SendHorizontal className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
        </div>
      </form>
    </section>
  )
}
