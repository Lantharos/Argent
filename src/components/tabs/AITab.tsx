import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import {
  ChevronDown,
  CircleDot,
  Copy,
  FileText,
  PencilLine,
  RotateCcw,
  SendHorizontal,
  Square,
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
  isActive?: boolean
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
const MODEL_CACHE_TTL_MS = 5 * 60 * 1000
const sharedModelOptionsCache: Record<string, ModelOption[]> = {}
const sharedModelOptionsFetchedAt: Record<string, number> = {}
const sharedModelOptionsInflight = new Map<string, Promise<ModelOption[]>>()

type EffortLevel = (typeof EFFORT_ORDER)[number]

type ModelFamily = {
  group: string
  name: string
  key: string
  variants: Array<ModelOption & { effort: EffortLevel }>
}

function asNonNegativeNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.trim())
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed
    }
  }
  return null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  return value as Record<string, unknown>
}

function normalizeUsageSnapshot(usage: unknown): { usedTokens: number | null; maxTokens: number | null } | null {
  const usageRecord = asRecord(usage)
  if (!usageRecord) {
    return null
  }

  const lastTokenUsage = asRecord(usageRecord.last_token_usage) ?? asRecord(usageRecord.lastTokenUsage)
  const usedTokens =
    asNonNegativeNumber(usageRecord.used) ??
    asNonNegativeNumber(usageRecord.total_tokens ?? usageRecord.totalTokens) ??
    asNonNegativeNumber(lastTokenUsage?.total_tokens ?? lastTokenUsage?.totalTokens)

  const maxTokens =
    asNonNegativeNumber(usageRecord.size) ??
    asNonNegativeNumber(usageRecord.model_context_window ?? usageRecord.modelContextWindow)

  if (usedTokens === null && maxTokens === null) {
    return null
  }

  return { usedTokens, maxTokens }
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

function formatThoughtMessage(content: string) {
  return `[[thought]]${encodeURIComponent(content)}`
}

function parseThoughtMessage(content: string) {
  if (!content.startsWith('[[thought]]')) {
    return null
  }

  const raw = content.slice('[[thought]]'.length)
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
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

export function AITab({ tab, isActive = true, cwd, providers, onChange, onSend }: Props) {
  const [loading, setLoading] = useState(false)
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [activeMetaPopover, setActiveMetaPopover] = useState<'local' | 'access' | 'context' | null>(null)
  const modelMenuRef = useRef<HTMLDivElement | null>(null)

  const [modelOptions, setModelOptions] = useState<ModelOption[]>([])
  const modelLoadTokenRef = useRef(0)
  const [modelFilter, setModelFilter] = useState('')
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})

  const activeRequestIdRef = useRef<string | null>(null)
  const cancelRequestedRef = useRef(false)
  const toolMessageIndexByIdRef = useRef<Record<string, number>>({})
  const pendingAssistantTextRef = useRef('')
  const flushTimerRef = useRef<number | null>(null)
  const tabRef = useRef(tab)
  const onChangeRef = useRef(onChange)
  const scrollRef = useRef<HTMLDivElement>(null)
  const isAutoScrolling = useRef(true)
  const isActiveRef = useRef(isActive)

  useEffect(() => {
    tabRef.current = tab
  }, [tab])

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    isActiveRef.current = isActive
  }, [isActive])

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
      const cached = sharedModelOptionsCache[selectedProvider.id] ?? []
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
    const parsedDirect = asNonNegativeNumber(direct)
    if (parsedDirect !== null) {
      return parsedDirect
    }

    if (selectedProvider) {
      const cached = sharedModelOptionsCache[selectedProvider.id] ?? []
      const fromCache = cached.find((item) => item.id === selectedModelValue)?.contextWindow
      const parsedFromCache = asNonNegativeNumber(fromCache)
      if (parsedFromCache !== null) {
        return parsedFromCache
      }
    }

    return null
  }, [modelOptions, selectedProvider, selectedModelValue])

  const selectedModelUsage = useMemo(() => {
    const modelId = selectedModelValue || selectedProvider?.model || ''
    if (!modelId) {
      return null
    }
    const usageByModel = tab.usageByModel ?? {}
    return usageByModel[modelId] ?? null
  }, [selectedModelValue, selectedProvider, tab.usageByModel])

  const resolvedContextWindow = useMemo(() => {
    if (typeof selectedModelContextWindow === 'number' && Number.isFinite(selectedModelContextWindow) && selectedModelContextWindow > 0) {
      return selectedModelContextWindow
    }
    const maxFromUsage = selectedModelUsage?.maxTokens
    if (typeof maxFromUsage === 'number' && Number.isFinite(maxFromUsage) && maxFromUsage > 0) {
      return maxFromUsage
    }
    return null
  }, [selectedModelContextWindow, selectedModelUsage])

  const estimatedTokens = useMemo(() => {
    let charCount = 0
    for (const msg of tab.messages) {
      charCount += msg.content.length
    }
    charCount += tab.input.length
    return 500 + Math.ceil(charCount / 4)
  }, [tab.messages, tab.input])

  const usedTokens = selectedModelUsage?.usedTokens ?? estimatedTokens

  const assistantModelLabel = useMemo(() => {
    return selectedModelLabel || selectedModelValue || selectedProvider?.model || 'Model'
  }, [selectedModelLabel, selectedModelValue, selectedProvider])

  useEffect(() => {
    setCollapsedGroups((prev) => {
      const next: Record<string, boolean> = {}
      for (const section of groupedModelFamilies) {
        next[section.group] = prev[section.group] ?? false
      }
      return next
    })
  }, [groupedModelFamilies])

  const lastUserMessageIndex = useMemo(() => {
    for (let i = tab.messages.length - 1; i >= 0; i--) {
      if (tab.messages[i].role === 'user') return i
    }
    return -1
  }, [tab.messages])

  const lastAssistantTextIndex = useMemo(() => {
    if (tab.messages.length === 0) {
      return -1
    }

    for (let index = tab.messages.length - 1; index >= 0; index -= 1) {
      const message = tab.messages[index]
      if (message.role === 'assistant' && !parseToolMessage(message.content) && !parseThoughtMessage(message.content)) {
        return index
      }
    }

    return -1
  }, [tab.messages])

  const updateTab = useCallback((updater: (current: AITabData) => AITabData) => {
    const next = updater(tabRef.current)
    tabRef.current = next
    onChangeRef.current(next)
  }, [])

  useEffect(() => {
    setLoading(Boolean(tab.isGenerating))
  }, [tab.isGenerating])

  useEffect(() => {
    if (!isActive || !tab.hasUnread) {
      return
    }

    updateTab((current) => ({
      ...current,
      hasUnread: false,
    }))
  }, [isActive, tab.hasUnread, updateTab])

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
      const isMetaLine =
        last?.role === 'assistant' &&
        typeof last?.content === 'string' &&
        (last.content.startsWith('[[tool]]') || last.content.startsWith('[[thought]]'))

      if (last && last.role === 'assistant' && !isMetaLine) {
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

  const scheduleAssistantFlush = useCallback(() => {
    if (flushTimerRef.current !== null) {
      return
    }

    const flush = () => {
      flushTimerRef.current = null
      const pending = pendingAssistantTextRef.current
      if (!pending) {
        return
      }

      const chunkSize = pending.length > 120 ? 10 : pending.length > 60 ? 6 : 3
      const nextChunk = pending.slice(0, chunkSize)
      pendingAssistantTextRef.current = pending.slice(chunkSize)
      appendAssistantDelta(nextChunk)

      if (pendingAssistantTextRef.current.length > 0) {
        flushTimerRef.current = window.setTimeout(flush, 16)
      }
    }

    flushTimerRef.current = window.setTimeout(flush, 16)
  }, [appendAssistantDelta])

  const enqueueAssistantDelta = useCallback((delta: string) => {
    if (!delta) {
      return
    }
    pendingAssistantTextRef.current += delta
    scheduleAssistantFlush()
  }, [scheduleAssistantFlush])

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
      if (event.type === 'thought-delta') {
        if (!event.delta) {
          return
        }

        updateTab((current) => {
          const messages = [...current.messages]
          const last = messages.at(-1)
          const lastThought =
            last?.role === 'assistant' && typeof last?.content === 'string' ? parseThoughtMessage(last.content) : null

          if (typeof lastThought === 'string') {
            messages[messages.length - 1] = {
              role: 'assistant',
              content: formatThoughtMessage(`${lastThought}${event.delta}`),
            }
          } else {
            messages.push({ role: 'assistant', content: formatThoughtMessage(event.delta) })
          }

          return {
            ...current,
            messages,
          }
        })
        return
      }

      if (event.type === 'text-delta') {
        enqueueAssistantDelta(event.delta)
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
        const wasCancelled = /cancel|aborted/i.test(event.message)

        updateTab((current) => {
          const messages = current.messages
            .filter((msg) => !(msg.role === 'assistant' && parseThoughtMessage(msg.content) !== null))
            .map((msg) => {
            if (msg.role === 'assistant') {
              const tool = parseToolMessage(msg.content)
              if (tool && (tool.status === 'in_progress' || tool.status === 'pending')) {
                return { ...msg, content: formatToolMessage(tool.title, 'failed', tool.kind, tool.detail) }
              }
            }
            return msg
            })
          return {
            ...current,
            messages,
            isGenerating: false,
            hasUnread: !isActiveRef.current,
          }
        })

        if (!wasCancelled) {
          enqueueAssistantDelta(`\n\nError: ${event.message}`)
        }
        return
      }

      if (event.type === 'done') {
        activeRequestIdRef.current = null
        setLoading(false)

        if (event.reply?.id) {
          updateTab((current) => ({
            ...current,
            acpSessionId: event.reply.id,
          }))
        }

        const snapshot = normalizeUsageSnapshot(event.reply?.usage)
        const modelId = event.reply?.model || tabRef.current.model || selectedProvider?.model || null
        if (snapshot && modelId) {
          updateTab((current) => ({
            ...current,
            usageByModel: {
              ...(current.usageByModel ?? {}),
              [modelId]: snapshot,
            },
          }))
        }

        updateTab((current) => {
          const messages = current.messages
            .filter((msg) => !(msg.role === 'assistant' && parseThoughtMessage(msg.content) !== null))
            .map((msg) => {
            if (msg.role === 'assistant') {
              const tool = parseToolMessage(msg.content)
              if (tool && (tool.status === 'in_progress' || tool.status === 'pending')) {
                return { ...msg, content: formatToolMessage(tool.title, 'completed', tool.kind, tool.detail) }
              }
            }
            return msg
            })
          return {
            ...current,
            messages,
            isGenerating: false,
            hasUnread: !isActiveRef.current,
          }
        })

        const reply = event.reply
        const current = tabRef.current
        const last = current.messages.at(-1)
        if ((!last || last.role !== 'assistant' || !last.content.trim()) && reply.content) {
          enqueueAssistantDelta(reply.content)
        }
      }
    })

    return () => {
      unsubscribe()
      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current)
        flushTimerRef.current = null
      }
      pendingAssistantTextRef.current = ''
    }
  }, [enqueueAssistantDelta, selectedProvider?.model, updateTab])

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
      const cached = sharedModelOptionsCache[providerId]
      if (cached && cached.length > 0) {
        setModelOptions(cached)
      } else {
        setModelOptions(fallback)
      }

      const token = modelLoadTokenRef.current + 1
      modelLoadTokenRef.current = token

      const hasFreshCache = Boolean(cached?.length) && Date.now() - (sharedModelOptionsFetchedAt[providerId] ?? 0) < MODEL_CACHE_TTL_MS
      let resolved = cached && cached.length > 0 ? cached : fallback

      if (hasFreshCache) {
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
        return
      }

      try {
        let inflight = sharedModelOptionsInflight.get(providerId)
        if (!inflight) {
          inflight = window.opensmith.ai
            .listModels({ providerId, cwd })
            .then((models) => {
              if (models.length > 0) {
                sharedModelOptionsCache[providerId] = models
                sharedModelOptionsFetchedAt[providerId] = Date.now()
              }
              return models
            })
            .finally(() => {
              sharedModelOptionsInflight.delete(providerId)
            })
          sharedModelOptionsInflight.set(providerId, inflight)
        }

        const models = await inflight
        if (token !== modelLoadTokenRef.current) {
          return
        }

        if (models.length > 0) {
          resolved = models
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

    const cleanMessages = current.messages
      .filter((msg) => !(msg.role === 'assistant' && parseThoughtMessage(msg.content) !== null))
      .map((msg) => {
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
      isGenerating: true,
      hasUnread: false,
    }))

    toolMessageIndexByIdRef.current = {}
    cancelRequestedRef.current = false

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
        sessionId: current.acpSessionId || undefined,
      })

      if (cancelRequestedRef.current) {
        setLoading(false)
        updateTab((prev) => ({
          ...prev,
          isGenerating: false,
        }))
        try {
          await window.opensmith.ai.streamCancel({ requestId: streamStart.requestId })
        } catch {
          // no-op
        }
        return
      }

      activeRequestIdRef.current = streamStart.requestId
    } catch {
      if (cancelRequestedRef.current) {
        setLoading(false)
        updateTab((prev) => ({
          ...prev,
          isGenerating: false,
        }))
        return
      }

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
            isGenerating: false,
            hasUnread: !isActiveRef.current,
          }
        })
      } finally {
        setLoading(false)
        updateTab((prev) => ({
          ...prev,
          isGenerating: false,
          hasUnread: !isActiveRef.current,
        }))
      }
    }
  }

  async function copyToClipboard(value: string) {
    if (!value) {
      return
    }

    try {
      await navigator.clipboard.writeText(value)
      return
    } catch {
      const textArea = document.createElement('textarea')
      textArea.value = value
      textArea.setAttribute('readonly', 'true')
      textArea.style.position = 'fixed'
      textArea.style.left = '-9999px'
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      document.body.removeChild(textArea)
    }
  }

  async function handleRetryLastAssistant() {
    if (loading || !selectedProvider || lastAssistantTextIndex < 0) {
      return
    }

    const current = tabRef.current
    const retryCutoff = lastAssistantTextIndex
    let lastUserIndex = -1
    for (let index = retryCutoff - 1; index >= 0; index -= 1) {
      if (current.messages[index]?.role === 'user') {
        lastUserIndex = index
        break
      }
    }

    if (lastUserIndex < 0) {
      return
    }

    const seededMessages = current.messages.slice(0, lastUserIndex + 1)
    const compacted = compactConversation(
      seededMessages.filter(
        (msg): msg is { role: 'user' | 'assistant'; content: string } =>
          (msg.role === 'user' || msg.role === 'assistant') && msg.content.length > 0,
      ),
    )

    activeRequestIdRef.current = null
    toolMessageIndexByIdRef.current = {}
    cancelRequestedRef.current = false

    updateTab((prev) => ({
      ...prev,
      providerId: selectedProvider.id,
      acpSessionId: null,
      messages: seededMessages,
      isGenerating: true,
      hasUnread: false,
    }))

    setLoading(true)
    isAutoScrolling.current = true

    try {
      const usable = compacted.filter(
        (msg): msg is { role: 'user' | 'assistant'; content: string } =>
          (msg.role === 'user' || msg.role === 'assistant') && msg.content.length > 0,
      )

      const streamStart = await window.opensmith.ai.streamStart({
        providerId: selectedProvider.id,
        messages: usable,
        cwd,
        model: current.model || selectedProvider.model,
        sessionId: undefined,
      })

      if (cancelRequestedRef.current) {
        setLoading(false)
        updateTab((prev) => ({
          ...prev,
          isGenerating: false,
        }))
        try {
          await window.opensmith.ai.streamCancel({ requestId: streamStart.requestId })
        } catch {
          // no-op
        }
        return
      }

      activeRequestIdRef.current = streamStart.requestId
    } catch {
      if (cancelRequestedRef.current) {
        setLoading(false)
        updateTab((prev) => ({
          ...prev,
          isGenerating: false,
        }))
        return
      }

      try {
        const usable = compacted.filter(
          (msg): msg is { role: 'user' | 'assistant'; content: string } =>
            msg.role === 'user' || msg.role === 'assistant',
        )
        const content = await onSend(selectedProvider.id, usable, cwd, current.model || selectedProvider.model)

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
            isGenerating: false,
            hasUnread: !isActiveRef.current,
          }
        })
      } finally {
        setLoading(false)
        updateTab((prev) => ({
          ...prev,
          isGenerating: false,
          hasUnread: !isActiveRef.current,
        }))
      }
    }
  }

  async function handleStopGeneration() {
    const requestId = activeRequestIdRef.current
    cancelRequestedRef.current = true

    setLoading(false)

    updateTab((current) => {
      const messages = current.messages
        .filter((msg) => !(msg.role === 'assistant' && parseThoughtMessage(msg.content) !== null))
        .map((msg) => {
        if (msg.role === 'assistant') {
          const tool = parseToolMessage(msg.content)
          if (tool && (tool.status === 'in_progress' || tool.status === 'pending')) {
            return { ...msg, content: formatToolMessage(tool.title, 'failed', tool.kind, tool.detail) }
          }
        }
        return msg
        })

      return {
        ...current,
        messages,
        isGenerating: false,
      }
    })

    if (!requestId) {
      return
    }

    activeRequestIdRef.current = null

    try {
      await window.opensmith.ai.streamCancel({ requestId })
    } catch {
      // no-op
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
            const parsedThought = message.role === 'assistant' ? parseThoughtMessage(message.content) : null
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

            if (parsedThought !== null) {
              return (
                <div key={index} className="mr-auto w-full max-w-full py-1">
                  <blockquote className="m-0 border-l-2 border-white/15 bg-white/[0.04] px-3 py-2 text-[13px] italic text-[#8f8f8f]">
                    <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={markdownComponents}>
                      {normalizeMarkdownSpacing(parsedThought)}
                    </ReactMarkdown>
                  </blockquote>
                </div>
              )
            }

            return (
          <div
            key={index}
            className={
              message.role === 'user'
                ? 'py-1 border-none ml-auto bg-white/12 shadow-sm ring-1 ring-white/10 rounded-2xl px-4 py-2.5 text-white max-w-[75%] whitespace-pre-wrap'
                : 'group py-1 px-0 border-none mr-auto bg-transparent text-[#b6b6b6] w-full max-w-full'
            }
          >
            {message.role === 'assistant' ? (
              <div>
                <div className="prose prose-invert max-w-none prose-p:my-2 prose-p:leading-7 prose-headings:my-2 prose-strong:text-[#efefef] prose-em:text-[#d6d6d6] prose-code:text-[#d9d9d9] prose-pre:bg-[#111111]/90 prose-pre:border prose-pre:border-white/10 prose-pre:rounded-xl prose-blockquote:border-l-white/25 prose-blockquote:text-[#c9c9c9] prose-table:my-3 prose-table:w-full prose-th:border prose-th:border-white/20 prose-th:px-2 prose-th:py-1 prose-td:border prose-td:border-white/15 prose-td:px-2 prose-td:py-1 prose-hr:border-white/15">
                  <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={markdownComponents}>
                    {normalizeMarkdownSpacing(message.content || '')}
                  </ReactMarkdown>
                  {loading && index === lastAssistantTextIndex ? (
                    <span className="inline-block animate-pulse text-[#f0f0f0]">▌</span>
                  ) : null}
                </div>
                {(() => {
                  const isCurrentTurn = index > lastUserMessageIndex
                  if (loading && isCurrentTurn) return null

                  let hasMoreText = false
                  for (let i = index + 1; i < tab.messages.length; i++) {
                    if (tab.messages[i].role === 'user') break
                    if (
                      tab.messages[i].role === 'assistant' &&
                      !parseToolMessage(tab.messages[i].content) &&
                      !parseThoughtMessage(tab.messages[i].content)
                    ) {
                      hasMoreText = true
                      break
                    }
                  }
                  
                  if (hasMoreText) return null

                  return (
                    <div className="mt-1.5 flex items-center justify-between text-[11px] text-[#8a8a8a] opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[#9a9a9a] hover:bg-white/8 hover:text-[#d0d0d0]"
                          onClick={() => {
                            void copyToClipboard(message.content || '')
                          }}
                        >
                          <Copy className="h-3.5 w-3.5" />
                          Copy
                        </button>
                        {index === lastAssistantTextIndex ? (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[#9a9a9a] hover:bg-white/8 hover:text-[#d0d0d0]"
                            onClick={() => {
                              void handleRetryLastAssistant()
                            }}
                            disabled={loading}
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            Retry
                          </button>
                        ) : null}
                      </div>
                      <span className="truncate pl-3 text-[#7d7d7d]">{assistantModelLabel}</span>
                    </div>
                  )
                })()}
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
          className="flex flex-col w-full rounded-3xl border border-white/20 hover:border-white/30 focus-within:border-white/40 transition px-1 bg-[#131313]/74 backdrop-blur-xl backdrop-saturate-150 text-[#e5e5e5] shadow-[0_20px_55px_rgba(0,0,0,0.5)]"
          dir="auto"
        >
          <div className="px-2.5">
            <textarea
              className="w-full bg-transparent outline-none border-0 resize-none text-[15px] text-[#ebebeb] placeholder:text-[#7f7f7f] pt-2.5 pb-[6px] px-1 min-h-[72px] max-h-72 overflow-auto"
              value={tab.input}
              onChange={(event) => updateTab((current) => ({ ...current, input: event.target.value }))}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || event.shiftKey) {
                  return
                }

                event.preventDefault()
                if (!loading && opencodeInstalled && tab.input.trim().length > 0) {
                  void handleSend()
                }
              }}
              placeholder={opencodeInstalled ? 'Ask OpenSmith anything, @ to add files, / for commands' : 'Install OpenCode CLI to enable AI chat'}
              rows={3}
            />
          </div>

          <div className="flex items-center justify-between mb-2.5 mx-1 border-t border-[#2c2c2c] pt-2">
            <div className="flex items-center gap-1.5">
              <div className="relative flex items-center" ref={modelMenuRef}>
                <button
                  type="button"
                  className="rounded-lg px-2 py-1.5 text-sm text-[#878787] outline-none hover:bg-white/8 hover:text-[#d0d0d0] inline-flex items-center gap-1.5 w-auto justify-between transition-colors duration-200"
                  onClick={() => setModelMenuOpen((prev) => !prev)}
                  aria-haspopup="listbox"
                  aria-expanded={modelMenuOpen}
                >
                  <span className="whitespace-nowrap">{selectedModelLabel}</span>
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>

                <button type="button" className="bg-transparent hover:bg-white/8 text-[#b8b8b8] transition rounded-full p-1.5 outline-none" onClick={addFileContext} aria-label="Add file">
                    <Plus className="h-4 w-4" />
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
              {(() => {
                const limit = resolvedContextWindow ?? 0
                const validLimit = limit > 0
                if (!validLimit) {
                  return null
                }
                const percentage = Math.min(100, Math.max(0, (usedTokens / limit) * 100))
                const circumference = 2 * Math.PI * 6 // r=6
                const strokeDashoffset = circumference - (percentage / 100) * circumference
                
                return (
                  <div className="relative">
                    <button
                      type="button"
                      className="text-xs text-[#aaaaaa] inline-flex items-center justify-center rounded-full p-1.5 hover:bg-[#242424] transition-colors gap-1"
                      onClick={() => setActiveMetaPopover((prev) => (prev === 'context' ? null : 'context'))}
                      aria-label="Context window limit"
                    >
                      <svg width="14" height="14" viewBox="0 0 14 14" className="-rotate-90">
                        <circle cx="7" cy="7" r="6" strokeWidth="2" fill="none" className="stroke-[#3a3a3a]" />
                        <circle 
                          cx="7" cy="7" r="6" strokeWidth="2" fill="none" 
                          className={percentage > 90 ? 'stroke-[#ef4444]' : percentage > 75 ? 'stroke-[#eab308]' : 'stroke-[#b5b5b5]'} 
                          strokeDasharray={circumference} 
                          strokeDashoffset={strokeDashoffset} 
                          strokeLinecap="round" 
                        />
                      </svg>
                    </button>
                    {activeMetaPopover === 'context' ? (
                      <div className="absolute right-0 bottom-[calc(100%+8px)] w-[250px] rounded-xl border border-[#353535] bg-[#161616] px-3.5 py-3 text-[12px] leading-relaxed shadow-[0_14px_30px_rgba(0,0,0,0.45)] z-40 text-left" role="status">
                        <div className="font-medium text-[#c0c0c0] mb-0.5">Context window</div>
                        <>
                          <div className="font-medium text-[#e0e0e0] text-[13px] mb-1">
                            {percentage.toFixed(1)}% used <span className="text-[#888] font-normal">({(100 - percentage).toFixed(1)}% left)</span>
                          </div>
                          <div className="text-[#888]">
                            {(usedTokens / 1000).toFixed(1)}k / {(limit / 1000).toFixed(1)}k tokens used
                          </div>
                        </>
                      </div>
                    ) : null}
                  </div>
                )
              })()}
              <div className="relative">
                <button
                  type="button"
                  className="text-xs text-[#aaaaaa] inline-flex items-center gap-1 rounded-full px-2 py-1 hover:bg-[#242424] transition-colors"
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

              {loading ? (
                <button
                  className="bg-[#ef4444] text-white hover:bg-[#dc2626] transition rounded-full size-9 flex items-center justify-center text-base font-semibold"
                  type="button"
                  onClick={() => {
                    void handleStopGeneration()
                  }}
                  aria-label="Stop generation"
                >
                  <Square className="h-3.5 w-3.5 fill-current" />
                </button>
              ) : (
                <button
                  className="bg-[#b0b0b0] text-[#151515] hover:bg-[#c8c8c8] transition rounded-full size-9 flex items-center justify-center text-base font-semibold disabled:opacity-45 disabled:hover:bg-[#b0b0b0]"
                  type="submit"
                  disabled={!opencodeInstalled || tab.input.trim().length === 0}
                >
                  <SendHorizontal className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      </form>
    </section>
  )
}
