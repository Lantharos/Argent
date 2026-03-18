import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import {
  Download,
  Check,
  ChevronDown,
  CircleDot,
  Copy,
  FileText,
  PencilLine,
  RotateCcw,
  SendHorizontal,
  Square,
  TerminalSquare,
  Trash2,
  Plus,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import type { AITabData, AIStreamEvent, PromptAttachment, ProviderConfig } from '../../types/argent'
import { extractModelMeta, ProviderGlyph } from './providerIcon'

type Props = {
  tab: AITabData
  isActive?: boolean
  spaceKind?: 'project' | 'global'
  cwd: string
  providers: ProviderConfig[]
  onChange: (next: AITabData) => void
  onSend: (
    providerId: string,
    messages: { role: 'user' | 'assistant'; content: string }[],
    cwd?: string,
    model?: string,
    attachments?: PromptAttachment[],
  ) => Promise<string>
}

type ModelOption = { id: string; label: string; contextWindow?: number | null }
type CommandOption = { name: string; description?: string }
type ModeOption = { id: string; name: string; description?: string }
type OpenCodeCliStatus = {
  installed: boolean
  version: string | null
  installMethods: Array<{ id: string; label: string; detail: string }>
}

const EFFORT_ORDER = ['base', 'thinking', 'low', 'medium', 'high', 'xhigh'] as const
const MODEL_CACHE_TTL_MS = 5 * 60 * 1000
const sharedModelOptionsCache: Record<string, ModelOption[]> = {}
const sharedModelOptionsFetchedAt: Record<string, number> = {}
const sharedModelOptionsInflight = new Map<string, Promise<ModelOption[]>>()
const sharedCommandOptionsCache: Record<string, CommandOption[]> = {}
const sharedCommandOptionsInflight = new Map<string, Promise<CommandOption[]>>()
let sharedOpenCodeCliStatus: OpenCodeCliStatus | null = null
let sharedOpenCodeCliStatusInflight: Promise<OpenCodeCliStatus> | null = null

function getSharedOpenCodeCliStatus(forceRefresh = false) {
  if (!forceRefresh && sharedOpenCodeCliStatus) {
    return Promise.resolve(sharedOpenCodeCliStatus)
  }

  if (!forceRefresh && sharedOpenCodeCliStatusInflight) {
    return sharedOpenCodeCliStatusInflight
  }

  sharedOpenCodeCliStatusInflight = window.argent.ai
    .getCliStatus()
    .then((status) => {
      sharedOpenCodeCliStatus = status
      return status
    })
    .finally(() => {
      sharedOpenCodeCliStatusInflight = null
    })

  return sharedOpenCodeCliStatusInflight
}

function getCommandInflightKey(providerId: string, cwd: string, sessionId?: string | null) {
  return `${providerId}::${cwd || ''}::${sessionId || ''}`
}

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

function clearStreamBuffer(bufferRef: { current: string }, timerRef: { current: number | null }) {
  bufferRef.current = ''
  if (timerRef.current !== null) {
    window.clearTimeout(timerRef.current)
    timerRef.current = null
  }
}

function toolStatusLabel(status: string) {
  if (status === 'pending') return 'Pending'
  if (status === 'in_progress' || status === 'running') return 'Running'
  if (status === 'completed') return 'Done'
  if (status === 'failed') return 'Failed'
  return status
}

function isToolActiveStatus(status: string) {
  return status === 'pending' || status === 'in_progress' || status === 'running'
}

function shouldStartNewThoughtAfterToolStatus(status: string) {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}

function normalizeToolDisplayStatus(status: string, loading: boolean) {
  if (!loading && isToolActiveStatus(status)) {
    return 'completed'
  }
  return status
}

function resolveRenderedToolStatus(
  status: string,
  loading: boolean,
  hasLaterVisibleMessage: boolean,
) {
  if (!loading && isToolActiveStatus(status)) {
    return 'completed'
  }
  if (loading && isToolActiveStatus(status) && hasLaterVisibleMessage) {
    return 'completed'
  }
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

function parsePlanMessage(content: string) {
  if (!content.startsWith('[[plan]]')) {
    return null
  }

  const raw = content.slice('[[plan]]'.length)
  let decoded = raw
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    decoded = raw
  }

  try {
    const parsed = JSON.parse(decoded)
    if (!Array.isArray(parsed)) {
      return null
    }
    return parsed
      .map((entry) => {
        const contentValue = typeof entry?.content === 'string' ? entry.content.trim() : ''
        if (!contentValue) {
          return null
        }
        const status = typeof entry?.status === 'string' ? entry.status : 'pending'
        const priority = typeof entry?.priority === 'string' ? entry.priority : null
        return {
          content: contentValue,
          status,
          priority,
        }
      })
      .filter((entry): entry is { content: string; status: string; priority: string | null } => Boolean(entry))
  } catch {
    return null
  }
}

function planStatusLabel(status: string) {
  if (status === 'in_progress') return 'Running'
  if (status === 'completed' || status === 'cancelled') return 'Done'
  if (status === 'pending') return 'Pending'
  return status
}

function parseTodoEntriesFromDetail(detail?: string | null) {
  if (!detail) {
    return null
  }

  const trimmed = detail.trim()
  let jsonText = trimmed
  if (!jsonText.startsWith('[') || !jsonText.endsWith(']')) {
    const firstBracket = jsonText.indexOf('[')
    const lastBracket = jsonText.lastIndexOf(']')
    if (firstBracket < 0 || lastBracket <= firstBracket) {
      return null
    }
    jsonText = jsonText.slice(firstBracket, lastBracket + 1)
  }

  if (!jsonText.startsWith('[') || !jsonText.endsWith(']')) {
    return null
  }

  try {
    const parsed = JSON.parse(jsonText)
    if (!Array.isArray(parsed)) {
      return null
    }

    const entries = parsed
      .map((entry) => {
        const content = typeof entry?.content === 'string' ? entry.content.trim() : ''
        if (!content) {
          return null
        }
        const status = typeof entry?.status === 'string' ? entry.status : 'pending'
        return { content, status }
      })
      .filter((entry): entry is { content: string; status: string } => Boolean(entry))

    return entries.length > 0 ? entries : null
  } catch {
    return null
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

function displayModeName(mode: ModeOption) {
  const id = mode.id.toLowerCase()
  if (id === 'build') return 'Agent'
  if (id === 'plan') return 'Plan'
  return mode.name || mode.id
}

function displayModeId(modeId: string | null | undefined) {
  const id = (modeId || '').trim().toLowerCase()
  if (!id) return 'Mode'
  if (id === 'build') return 'Agent'
  if (id === 'plan') return 'Plan'
  return id[0].toUpperCase() + id.slice(1)
}

function inferMimeTypeFromName(name: string) {
  const lowered = name.toLowerCase()
  if (lowered.endsWith('.png')) return 'image/png'
  if (lowered.endsWith('.jpg') || lowered.endsWith('.jpeg')) return 'image/jpeg'
  if (lowered.endsWith('.gif')) return 'image/gif'
  if (lowered.endsWith('.webp')) return 'image/webp'
  if (lowered.endsWith('.bmp')) return 'image/bmp'
  if (lowered.endsWith('.svg')) return 'image/svg+xml'
  if (lowered.endsWith('.pdf')) return 'application/pdf'
  if (lowered.endsWith('.md')) return 'text/markdown'
  if (lowered.endsWith('.txt')) return 'text/plain'
  return 'application/octet-stream'
}

function filePathToFileUrl(filePath: string) {
  const normalized = filePath.replace(/\\/g, '/')
  const prefixed = normalized.startsWith('/') ? normalized : `/${normalized}`
  return encodeURI(`file://${prefixed}`)
}

function getAttachmentPreviewSrc(attachment: PromptAttachment) {
  if (attachment.kind === 'image') {
    const mimeType = attachment.mimeType || inferMimeTypeFromName(attachment.name)
    return `data:${mimeType};base64,${attachment.data}`
  }

  if (attachment.kind === 'file' && attachment.path && (attachment.mimeType || '').startsWith('image/')) {
    return filePathToFileUrl(attachment.path)
  }

  return null
}

function createAttachmentId() {
  return `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function readFileAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      const commaIndex = result.indexOf(',')
      if (commaIndex < 0) {
        reject(new Error('Invalid image data'))
        return
      }
      resolve(result.slice(commaIndex + 1))
    }
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

export function AITab({ tab, isActive = true, spaceKind = 'project', cwd, providers, onChange, onSend }: Props) {
  const [loading, setLoading] = useState(false)
  const [copiedMessageIndex, setCopiedMessageIndex] = useState<number | null>(null)
  const [isComposerDragging, setIsComposerDragging] = useState(false)
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [activeMetaPopover, setActiveMetaPopover] = useState<'local' | 'access' | 'context' | null>(null)
  const modelMenuRef = useRef<HTMLDivElement | null>(null)
  const modeMenuRef = useRef<HTMLDivElement | null>(null)

  const [modelOptions, setModelOptions] = useState<ModelOption[]>([])
  const [modeOptions, setModeOptions] = useState<ModeOption[]>([])
  const [commandOptions, setCommandOptions] = useState<CommandOption[]>([])
  const [opencodeCliStatus, setOpencodeCliStatus] = useState<OpenCodeCliStatus | null>(null)
  const [installingOpenCodeMethodId, setInstallingOpenCodeMethodId] = useState<string | null>(null)
  const [opencodeInstallMessage, setOpencodeInstallMessage] = useState<string | null>(null)
  const [isLoadingModelOptions, setIsLoadingModelOptions] = useState(false)
  const [isLoadingModeOptions, setIsLoadingModeOptions] = useState(false)
  const [isAssistantFlushActive, setIsAssistantFlushActive] = useState(false)
  const [isThoughtFlushActive, setIsThoughtFlushActive] = useState(false)
  const [commandMenuIndex, setCommandMenuIndex] = useState(0)
  const modelLoadTokenRef = useRef(0)
  const [modelFilter, setModelFilter] = useState('')
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})

  const activeRequestIdRef = useRef<string | null>(null)
  const lastStreamEventAtRef = useRef<number>(0)
  const toolStatusByIdRef = useRef<Record<string, string>>({})
  const cancelRequestedRef = useRef(false)
  const toolMessageIndexByIdRef = useRef<Record<string, number>>({})
  const pendingAssistantTextRef = useRef('')
  const flushTimerRef = useRef<number | null>(null)
  const activeAssistantMessageIndexRef = useRef<number | null>(null)
  const activeThoughtMessageIndexRef = useRef<number | null>(null)
  const shouldStartNewThoughtBlockRef = useRef(false)
  const pendingThoughtTextRef = useRef('')
  const thoughtFlushTimerRef = useRef<number | null>(null)
  const tabRef = useRef(tab)
  const onChangeRef = useRef(onChange)
  const scrollRef = useRef<HTMLDivElement>(null)
  const isAutoScrolling = useRef(true)
  const isProgrammaticScrollRef = useRef(false)
  const isActiveRef = useRef(isActive)
  const copiedResetTimerRef = useRef<number | null>(null)

  useEffect(() => {
    tabRef.current = tab
  }, [tab])

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    isActiveRef.current = isActive
  }, [isActive])

  useEffect(() => {
    return () => {
      if (copiedResetTimerRef.current !== null) {
        window.clearTimeout(copiedResetTimerRef.current)
        copiedResetTimerRef.current = null
      }
    }
  }, [])

  const refreshOpenCodeCliStatus = useCallback(async (forceRefresh = false) => {
    try {
      const status = await getSharedOpenCodeCliStatus(forceRefresh)
      setOpencodeCliStatus(status)
    } catch (error) {
      const fallbackStatus = {
        installed: false,
        version: null,
        installMethods: [],
      }
      sharedOpenCodeCliStatus = fallbackStatus
      setOpencodeCliStatus(fallbackStatus)
      setOpencodeInstallMessage(error instanceof Error ? error.message : String(error))
    }
  }, [])

  useEffect(() => {
    if (sharedOpenCodeCliStatus) {
      setOpencodeCliStatus(sharedOpenCodeCliStatus)
      return
    }
    void refreshOpenCodeCliStatus()
  }, [refreshOpenCodeCliStatus])

  useEffect(() => {
    if (!opencodeInstallMessage) {
      return
    }

    const timeout = window.setTimeout(() => {
      setOpencodeInstallMessage(null)
    }, 5000)

    return () => window.clearTimeout(timeout)
  }, [opencodeInstallMessage])

  const selectedProvider = useMemo<ProviderConfig | null>(
    () => providers.find((provider) => provider.id === 'opencode-acp') ?? null,
    [providers],
  )

  const hasOpenCodeProvider = Boolean(selectedProvider)
  const opencodeInstalled = hasOpenCodeProvider && Boolean(opencodeCliStatus?.installed)
  const checkingOpenCodeCli = opencodeCliStatus === null
  const selectedModelValue = tab.model || selectedProvider?.model || null
  const selectedModeId = tab.acpModeId || null
  const isLoadingOpenCodeMeta =
    opencodeInstalled &&
    ((isLoadingModelOptions && modelOptions.length === 0) || (isLoadingModeOptions && modeOptions.length === 0))
  const openCodeProviderKey = useMemo(
    () => extractModelMeta('OpenCode/loading', 'opencode/loading', 'opencode').providerKey,
    [],
  )

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

  const selectedModelMeta = useMemo(() => {
    return extractModelMeta(selectedModelLabel, selectedModelValue, selectedProvider?.id || tab.providerId || null)
  }, [selectedModelLabel, selectedModelValue, selectedProvider, tab.providerId])

  const selectedModeOption = useMemo(() => {
    if (!selectedModeId) {
      return null
    }
    return modeOptions.find((mode) => mode.id === selectedModeId) || null
  }, [modeOptions, selectedModeId])

  const modeLabel = selectedModeOption ? displayModeName(selectedModeOption) : displayModeId(selectedModeId)

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
  const composerAttachments = tab.attachments ?? []
  const isStreamingUi = loading || isAssistantFlushActive || isThoughtFlushActive
  const slashInputState = useMemo(() => {
    const lines = tab.input.split('\n')
    const firstLine = lines[0] ?? ''
    if (!firstLine.startsWith('/')) {
      return {
        active: false,
        query: '',
      }
    }

    const commandSegment = firstLine.slice(1)
    const whitespaceIndex = commandSegment.search(/\s/)
    const token = (whitespaceIndex >= 0 ? commandSegment.slice(0, whitespaceIndex) : commandSegment).trim()
    return {
      active: true,
      query: token.toLowerCase(),
    }
  }, [tab.input])

  const slashCommandSuggestions = useMemo(() => {
    if (!slashInputState.active) {
      return []
    }

    const query = slashInputState.query
    const options = query
      ? commandOptions.filter((item) => item.name.toLowerCase().includes(query))
      : commandOptions

    return options.slice(0, 8)
  }, [commandOptions, slashInputState])

  const slashCommandMenuOpen = slashInputState.active && slashCommandSuggestions.length > 0

  useEffect(() => {
    if (!slashCommandMenuOpen) {
      setCommandMenuIndex(0)
      return
    }
    setCommandMenuIndex((prev) => Math.max(0, Math.min(prev, slashCommandSuggestions.length - 1)))
  }, [slashCommandMenuOpen, slashCommandSuggestions.length])

  const assistantModelLabel = useMemo(() => {
    const label = selectedModelLabel || selectedModelValue || selectedProvider?.model || 'Model'
    return extractModelMeta(label, selectedModelValue, selectedProvider?.id || tab.providerId || null)
  }, [selectedModelLabel, selectedModelValue, selectedProvider, tab.providerId])

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
      if (
        message.role === 'assistant' &&
        !parseToolMessage(message.content) &&
        !parseThoughtMessage(message.content) &&
        !parsePlanMessage(message.content)
      ) {
        return index
      }
    }

    return -1
  }, [tab.messages])

  const lastAssistantThoughtIndex = useMemo(() => {
    if (tab.messages.length === 0) {
      return -1
    }

    for (let index = tab.messages.length - 1; index >= 0; index -= 1) {
      const message = tab.messages[index]
      if (message.role === 'assistant' && parseThoughtMessage(message.content) !== null) {
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

  const selectModel = useCallback(
    (modelId: string, options?: { closeMenu?: boolean }) => {
      updateTab((current) => ({ ...current, model: modelId }))
      setModelFilter('')
      if (options?.closeMenu ?? true) {
        setModelMenuOpen(false)
      }
    },
    [updateTab],
  )

  const selectMode = useCallback(
    (mode: ModeOption) => {
      updateTab((current) => ({
        ...current,
        acpModeId: mode.id,
      }))
      setActiveMetaPopover(null)

      if (!selectedProvider) {
        return
      }

      void window.argent.ai
        .setMode({
          providerId: selectedProvider.id,
          cwd,
          sessionId: tabRef.current.acpSessionId || undefined,
          modeId: mode.id,
        })
        .then((result) => {
          updateTab((current) => ({
            ...current,
            acpSessionId: result.sessionId,
            acpModeId: result.modeId,
          }))
        })
        .catch(() => {
          // no-op
        })
    },
    [cwd, selectedProvider, updateTab],
  )

  const handleInstallOpenCode = useCallback(
    async (methodId: string) => {
      setInstallingOpenCodeMethodId(methodId)
      setOpencodeInstallMessage(null)

      try {
        const status = await window.argent.ai.installCli({ methodId })
        sharedOpenCodeCliStatus = status
        setOpencodeCliStatus(status)
        setOpencodeInstallMessage(
          status.installed
            ? `OpenCode CLI installed${status.version ? ` (${status.version})` : ''}.`
            : 'OpenCode CLI install finished, but the binary is still unavailable.',
        )
      } catch (error) {
        setOpencodeInstallMessage(error instanceof Error ? error.message : String(error))
      } finally {
        setInstallingOpenCodeMethodId(null)
      }
    },
    [],
  )

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
    if (!isAutoScrolling.current || !scrollRef.current) {
      return
    }

    const element = scrollRef.current
    isProgrammaticScrollRef.current = true
    const frame = window.requestAnimationFrame(() => {
      element.scrollTop = element.scrollHeight
      window.requestAnimationFrame(() => {
        isProgrammaticScrollRef.current = false
      })
    })

    return () => {
      window.cancelAnimationFrame(frame)
      isProgrammaticScrollRef.current = false
    }
  }, [tab.messages, isStreamingUi])

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return
    if (isProgrammaticScrollRef.current) return
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
        (last.content.startsWith('[[tool]]') || last.content.startsWith('[[thought]]') || last.content.startsWith('[[plan]]'))

      if (last && last.role === 'assistant' && !isMetaLine) {
        activeAssistantMessageIndexRef.current = messages.length - 1
        messages[messages.length - 1] = {
          ...last,
          content: `${last.content}${delta}`,
        }
      } else {
        messages.push({ role: 'assistant', content: delta })
        activeAssistantMessageIndexRef.current = messages.length - 1
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
    setIsAssistantFlushActive(true)

    const flush = () => {
      flushTimerRef.current = null
      const pending = pendingAssistantTextRef.current
      if (!pending) {
        setIsAssistantFlushActive(false)
        return
      }

      const chunkSize = pending.length > 120 ? 10 : pending.length > 60 ? 6 : 3
      const nextChunk = pending.slice(0, chunkSize)
      pendingAssistantTextRef.current = pending.slice(chunkSize)
      appendAssistantDelta(nextChunk)

      if (pendingAssistantTextRef.current.length > 0) {
        flushTimerRef.current = window.setTimeout(flush, 16)
      } else {
        setIsAssistantFlushActive(false)
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

  const appendThoughtDelta = useCallback((delta: string) => {
    if (!delta) {
      return
    }

    updateTab((current) => {
      const messages = [...current.messages]
      const existingIndex = activeThoughtMessageIndexRef.current
      const existingMessage =
        typeof existingIndex === 'number' && existingIndex >= 0 && existingIndex < messages.length
          ? messages[existingIndex]
          : null
      const existingThought =
        existingMessage?.role === 'assistant' && typeof existingMessage.content === 'string'
          ? parseThoughtMessage(existingMessage.content)
          : null

      if (typeof existingThought === 'string' && typeof existingIndex === 'number') {
        messages[existingIndex] = {
          role: 'assistant',
          content: formatThoughtMessage(`${existingThought}${delta}`),
        }
      } else {
        messages.push({ role: 'assistant', content: formatThoughtMessage(delta) })
        activeThoughtMessageIndexRef.current = messages.length - 1
      }

      return {
        ...current,
        messages,
      }
    })
  }, [updateTab])

  const scheduleThoughtFlush = useCallback(() => {
    if (thoughtFlushTimerRef.current !== null) {
      return
    }
    setIsThoughtFlushActive(true)

    const flush = () => {
      thoughtFlushTimerRef.current = null
      const pending = pendingThoughtTextRef.current
      if (!pending) {
        setIsThoughtFlushActive(false)
        return
      }

      const chunkSize = pending.length > 140 ? 12 : pending.length > 80 ? 8 : 4
      const nextChunk = pending.slice(0, chunkSize)
      pendingThoughtTextRef.current = pending.slice(chunkSize)
      appendThoughtDelta(nextChunk)

      if (pendingThoughtTextRef.current.length > 0) {
        thoughtFlushTimerRef.current = window.setTimeout(flush, 16)
      } else {
        setIsThoughtFlushActive(false)
      }
    }

    thoughtFlushTimerRef.current = window.setTimeout(flush, 16)
  }, [appendThoughtDelta])

  const enqueueThoughtDelta = useCallback((delta: string) => {
    if (!delta) {
      return
    }
    pendingThoughtTextRef.current += delta
    scheduleThoughtFlush()
  }, [scheduleThoughtFlush])

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
    const unsubscribe = window.argent.ai.onStreamEvent((payload) => {
      if (payload.requestId !== activeRequestIdRef.current) {
        return
      }

      lastStreamEventAtRef.current = Date.now()

      const event = payload.event as AIStreamEvent
      if (event.type === 'thought-delta') {
        if (!event.delta) {
          return
        }

        if (shouldStartNewThoughtBlockRef.current) {
          activeThoughtMessageIndexRef.current = null
          shouldStartNewThoughtBlockRef.current = false
        }

        enqueueThoughtDelta(event.delta)
        return
      }

      if (event.type === 'text-delta') {
        activeThoughtMessageIndexRef.current = null
        shouldStartNewThoughtBlockRef.current = false
        enqueueAssistantDelta(event.delta)
        return
      }

      if (event.type === 'commands') {
        const next = Array.isArray(event.commands) ? event.commands : []
        if (next.length > 0 && selectedProvider) {
          sharedCommandOptionsCache[selectedProvider.id] = next
          setCommandOptions(next)
        }
        return
      }

      if (event.type === 'plan') {
        // Plan updates are already reflected by tool-call rows; skip custom plan cards.
        return
      }

      if (event.type === 'tool') {
        const toolId = event.id || `${event.kind || 'tool'}:${event.title}`
        toolStatusByIdRef.current[toolId] = event.status
        if (shouldStartNewThoughtAfterToolStatus(event.status)) {
          shouldStartNewThoughtBlockRef.current = true
        }

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
        toolStatusByIdRef.current = {}
        activeThoughtMessageIndexRef.current = null
        shouldStartNewThoughtBlockRef.current = false
        clearStreamBuffer(pendingThoughtTextRef, thoughtFlushTimerRef)
        setIsThoughtFlushActive(false)
        setLoading(false)
        const wasCancelled = /cancel|aborted/i.test(event.message)

        updateTab((current) => {
          const messages = current.messages
            .filter((msg) => !(msg.role === 'assistant' && parseThoughtMessage(msg.content) !== null))
            .map((msg) => {
            if (msg.role === 'assistant') {
              const tool = parseToolMessage(msg.content)
              if (tool && isToolActiveStatus(tool.status)) {
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
        toolStatusByIdRef.current = {}
        activeThoughtMessageIndexRef.current = null
        shouldStartNewThoughtBlockRef.current = false
        setLoading(false)

        if (event.reply?.id) {
          updateTab((current) => ({
            ...current,
            acpSessionId: event.reply.id,
          }))
        }

        if (selectedProvider?.id && event.reply?.id) {
          void window.argent.ai
            .listModes({
              providerId: selectedProvider.id,
              cwd,
              sessionId: event.reply.id,
            })
            .then((modeState) => {
              const nextModes = Array.isArray(modeState?.modes) ? modeState.modes : []
              if (nextModes.length > 0) {
                setModeOptions(nextModes)
              }

              const currentModeId = typeof modeState?.currentModeId === 'string' ? modeState.currentModeId : null
              if (currentModeId) {
                updateTab((current) => ({
                  ...current,
                  acpModeId: currentModeId,
                }))
              }
            })
            .catch(() => {
              // no-op
            })
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
              if (tool && isToolActiveStatus(tool.status)) {
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
      clearStreamBuffer(pendingAssistantTextRef, flushTimerRef)
      clearStreamBuffer(pendingThoughtTextRef, thoughtFlushTimerRef)
      setIsAssistantFlushActive(false)
      setIsThoughtFlushActive(false)
    }
  }, [cwd, enqueueAssistantDelta, enqueueThoughtDelta, selectedProvider, updateTab])

  useEffect(() => {
    if (isStreamingUi) {
      return
    }

    activeAssistantMessageIndexRef.current = null
    activeThoughtMessageIndexRef.current = null
  }, [isStreamingUi])

  useEffect(() => {
    if (!loading) {
      return
    }

    const timer = window.setInterval(() => {
      const requestId = activeRequestIdRef.current
      if (!requestId) {
        return
      }

      const lastEventAt = lastStreamEventAtRef.current
      if (!lastEventAt) {
        return
      }

      const idleForMs = Date.now() - lastEventAt
      if (idleForMs < 8000) {
        return
      }

      const statuses = Object.values(toolStatusByIdRef.current)
      const hasActiveTools = statuses.some((status) => isToolActiveStatus(status))
      if (hasActiveTools) {
        return
      }

      const hasAssistantText = tabRef.current.messages.some(
        (message) =>
          message.role === 'assistant' &&
          !parseToolMessage(message.content) &&
          !parseThoughtMessage(message.content) &&
          !parsePlanMessage(message.content) &&
          message.content.trim().length > 0,
      )

      if (!hasAssistantText) {
        return
      }

      const staleRequestId = activeRequestIdRef.current
      activeRequestIdRef.current = null
      toolStatusByIdRef.current = {}
      activeThoughtMessageIndexRef.current = null
      shouldStartNewThoughtBlockRef.current = false
      clearStreamBuffer(pendingThoughtTextRef, thoughtFlushTimerRef)
      setIsThoughtFlushActive(false)
      setLoading(false)

      updateTab((current) => {
        const messages = current.messages
          .filter((msg) => !(msg.role === 'assistant' && parseThoughtMessage(msg.content) !== null))
          .map((msg) => {
            if (msg.role === 'assistant') {
              const tool = parseToolMessage(msg.content)
              if (tool && isToolActiveStatus(tool.status)) {
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

      if (staleRequestId) {
        void window.argent.ai.streamCancel({ requestId: staleRequestId }).catch(() => {
          // no-op
        })
      }
    }, 1000)

    return () => window.clearInterval(timer)
  }, [loading, updateTab])

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null
      if (!target) {
        return
      }
      if (modelMenuRef.current?.contains(target)) {
        return
      }
      if (modeMenuRef.current?.contains(target)) {
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
      if (!selectedProvider || !opencodeInstalled) {
        setModelOptions([])
        setIsLoadingModelOptions(false)
        return
      }

      setIsLoadingModelOptions(true)
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
        setIsLoadingModelOptions(false)
        return
      }

      try {
        let inflight = sharedModelOptionsInflight.get(providerId)
        if (!inflight) {
          inflight = window.argent.ai
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
        void refreshOpenCodeCliStatus(true)
      } finally {
        if (token === modelLoadTokenRef.current) {
          setIsLoadingModelOptions(false)
        }
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
  }, [selectedProvider, cwd, opencodeInstalled, refreshOpenCodeCliStatus, updateTab])

  useEffect(() => {
    let cancelled = false

    async function loadModes() {
      if (!selectedProvider || !opencodeInstalled) {
        setModeOptions([])
        setIsLoadingModeOptions(false)
        return
      }

      setIsLoadingModeOptions(true)
      try {
        const modeState = await window.argent.ai.listModes({
          providerId: selectedProvider.id,
          cwd,
          sessionId: tabRef.current.acpSessionId || undefined,
        })

        const modes = Array.isArray(modeState?.modes)
          ? modeState.modes
              .filter((item) => typeof item?.id === 'string' && item.id.trim().length > 0)
              .map((item) => ({
                id: item.id.trim(),
                name: typeof item.name === 'string' ? item.name : item.id,
                description: typeof item.description === 'string' ? item.description : '',
              }))
          : []

        setModeOptions(modes)

        const modeId = typeof modeState?.currentModeId === 'string' ? modeState.currentModeId : null
        const modeSessionId = typeof modeState?.sessionId === 'string' ? modeState.sessionId : null

        if (modeId || modeSessionId) {
          updateTab((current) => ({
            ...current,
            ...(modeId ? { acpModeId: modeId } : {}),
            ...(modeSessionId ? { acpSessionId: modeSessionId } : {}),
          }))
        }
      } catch {
        setModeOptions([])
        void refreshOpenCodeCliStatus(true)
      } finally {
        if (!cancelled) {
          setIsLoadingModeOptions(false)
        }
      }
    }

    void loadModes()
    return () => {
      cancelled = true
    }
  }, [selectedProvider, cwd, opencodeInstalled, refreshOpenCodeCliStatus, updateTab])

  useEffect(() => {
    async function loadCommands() {
      if (!selectedProvider || !opencodeInstalled) {
        setCommandOptions([])
        return
      }

      const providerId = selectedProvider.id
      const activeSessionId = tabRef.current.acpSessionId || ''
      const inflightKey = getCommandInflightKey(providerId, cwd, activeSessionId)
      const cached = sharedCommandOptionsCache[providerId]
      if (cached && cached.length > 0) {
        setCommandOptions(cached)
      }

      try {
        let inflight = sharedCommandOptionsInflight.get(inflightKey)
        if (!inflight) {
          inflight = window.argent.ai
            .listCommands({
              providerId,
              cwd,
              sessionId: activeSessionId || undefined,
            })
            .then((commands) => {
              const normalized = Array.isArray(commands)
                ? commands
                    .filter((item) => typeof item?.name === 'string' && item.name.trim().length > 0)
                    .map((item) => ({
                      name: item.name.trim(),
                      description: typeof item.description === 'string' ? item.description : '',
                    }))
                : []

              if (normalized.length > 0) {
                sharedCommandOptionsCache[providerId] = normalized
              }
              return normalized
            })
            .finally(() => {
              sharedCommandOptionsInflight.delete(inflightKey)
            })
          sharedCommandOptionsInflight.set(inflightKey, inflight)
        }

        const commands = await inflight
        if (commands.length > 0) {
          setCommandOptions(commands)
        }
      } catch {
        if (!cached || cached.length === 0) {
          setCommandOptions([])
        }
        void refreshOpenCodeCliStatus(true)
      }
    }

    void loadCommands()
  }, [selectedProvider, cwd, opencodeInstalled, refreshOpenCodeCliStatus, tab.acpSessionId])

  const applySlashCommand = useCallback((name: string) => {
    updateTab((current) => {
      const lines = current.input.split('\n')
      const firstLine = lines[0] ?? ''
      if (!firstLine.startsWith('/')) {
        return current
      }

      const commandSegment = firstLine.slice(1)
      const whitespaceIndex = commandSegment.search(/\s/)
      const remainder = whitespaceIndex >= 0 ? commandSegment.slice(whitespaceIndex + 1).trimStart() : ''
      lines[0] = `/${name}${remainder ? ` ${remainder}` : ' '}`

      return {
        ...current,
        input: lines.join('\n'),
      }
    })
  }, [updateTab])

  async function addFileAttachment() {
    const picked = await window.argent.fs.openFile(null)
    if (!picked) {
      return
    }

    const name = picked.split(/[/\\]/).at(-1) ?? picked
    const next: PromptAttachment = {
      id: createAttachmentId(),
      kind: 'file',
      name,
      path: picked,
      mimeType: inferMimeTypeFromName(name),
    }

    updateTab((current) => ({
      ...current,
      attachments: [...(current.attachments ?? []), next],
    }))
  }

  async function buildAttachmentsFromFiles(files: File[]) {
    const nextAttachments: PromptAttachment[] = []

    for (const file of files) {
      const filePath = (file as File & { path?: string }).path
      const name = file.name || (filePath ? filePath.split(/[/\\]/).at(-1) : 'attachment') || 'attachment'
      const mimeType = file.type || inferMimeTypeFromName(name)

      if (mimeType.startsWith('image/')) {
        try {
          const data = await readFileAsBase64(file)
          nextAttachments.push({
            id: createAttachmentId(),
            kind: 'image',
            name,
            data,
            mimeType,
          })
        } catch {
          // no-op
        }
        continue
      }

      if (filePath) {
        nextAttachments.push({
          id: createAttachmentId(),
          kind: 'file',
          name,
          path: filePath,
          mimeType,
        })
      }
    }

    return nextAttachments
  }

  async function handlePaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = Array.from(event.clipboardData?.items ?? [])
    if (items.length === 0) {
      return
    }

    const files = items
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file))

    if (files.length === 0) {
      return
    }

    const canHandle = files.some((file) => {
      const filePath = (file as File & { path?: string }).path
      return file.type.startsWith('image/') || Boolean(filePath)
    })

    if (!canHandle) {
      return
    }

    event.preventDefault()

    const nextAttachments = await buildAttachmentsFromFiles(files)

    if (nextAttachments.length === 0) {
      return
    }

    updateTab((current) => ({
      ...current,
      attachments: [...(current.attachments ?? []), ...nextAttachments],
    }))
  }

  async function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    const dropped = Array.from(event.dataTransfer?.files ?? [])
    setIsComposerDragging(false)
    if (dropped.length === 0) {
      return
    }

    event.preventDefault()
    const nextAttachments = await buildAttachmentsFromFiles(dropped)
    if (nextAttachments.length === 0) {
      return
    }

    updateTab((current) => ({
      ...current,
      attachments: [...(current.attachments ?? []), ...nextAttachments],
    }))
  }

  async function handleSend() {
    const current = tabRef.current
    const input = current.input.trim()
    const attachments = current.attachments ?? []
    const provider = selectedProvider

    if (!provider || (input.length === 0 && attachments.length === 0) || loading) {
      return
    }

    const cleanMessages = current.messages
      .filter((msg) => !(msg.role === 'assistant' && parseThoughtMessage(msg.content) !== null))
      .map((msg) => {
        if (msg.role === 'assistant') {
          const tool = parseToolMessage(msg.content)
          if (tool && isToolActiveStatus(tool.status)) {
            return { ...msg, content: formatToolMessage(tool.title, 'completed', tool.kind, tool.detail) }
          }
        }
        return msg
      })

    const hasUserMessages = cleanMessages.some((msg) => msg.role === 'user' && msg.content.trim().length > 0)
    const shouldRetitle = !hasUserMessages && (current.title.trim().length === 0 || current.title === 'AI Chat')
    const nextTitle = shouldRetitle ? summarizeTabTitleFromPrompt(input) : current.title

    const attachmentSummary = attachments.map((item) => item.name).slice(0, 3).join(', ')
    const fallbackUserText = attachments.length > 0
      ? `Attached ${attachments.length} item${attachments.length === 1 ? '' : 's'}${attachmentSummary ? `: ${attachmentSummary}` : ''}`
      : ''
    const userMessageText = input || fallbackUserText

    const withUser: AITabData['messages'] = [
      ...cleanMessages,
      {
        role: 'user',
        content: userMessageText,
        attachments: attachments.length > 0 ? attachments : undefined,
      },
    ]
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
      attachments: [],
      providerId: provider.id,
      messages: withUser,
      isGenerating: true,
      hasUnread: false,
    }))

    toolMessageIndexByIdRef.current = {}
    toolStatusByIdRef.current = {}
    lastStreamEventAtRef.current = 0
    activeAssistantMessageIndexRef.current = null
    activeThoughtMessageIndexRef.current = null
    shouldStartNewThoughtBlockRef.current = false
    cancelRequestedRef.current = false
    clearStreamBuffer(pendingAssistantTextRef, flushTimerRef)
    clearStreamBuffer(pendingThoughtTextRef, thoughtFlushTimerRef)
    setIsAssistantFlushActive(false)
    setIsThoughtFlushActive(false)

    setLoading(true)
    isAutoScrolling.current = true

    try {
      const usable = compacted.filter(
        (msg): msg is { role: 'user' | 'assistant'; content: string } =>
          (msg.role === 'user' || msg.role === 'assistant') && msg.content.length > 0,
      )

      const streamStart = await window.argent.ai.streamStart({
        providerId: provider.id,
        messages: usable,
        cwd,
        model: current.model || provider.model,
        attachments,
        modeId: current.acpModeId || undefined,
        sessionId: current.acpSessionId || undefined,
      })

      if (cancelRequestedRef.current) {
        setLoading(false)
        updateTab((prev) => ({
          ...prev,
          isGenerating: false,
        }))
        try {
          await window.argent.ai.streamCancel({ requestId: streamStart.requestId })
        } catch {
          // no-op
        }
        return
      }

      activeRequestIdRef.current = streamStart.requestId
      lastStreamEventAtRef.current = Date.now()
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
        const content = await onSend(provider.id, usable, cwd, current.model || provider.model, attachments)

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

  async function copyToClipboard(value: string, messageIndex: number) {
    if (!value) {
      return
    }

    try {
      await navigator.clipboard.writeText(value)
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

    setCopiedMessageIndex(messageIndex)
    if (copiedResetTimerRef.current !== null) {
      window.clearTimeout(copiedResetTimerRef.current)
    }
    copiedResetTimerRef.current = window.setTimeout(() => {
      setCopiedMessageIndex((current) => (current === messageIndex ? null : current))
      copiedResetTimerRef.current = null
    }, 1200)
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
    const retryAttachments = seededMessages[lastUserIndex]?.attachments ?? []
    const compacted = compactConversation(
      seededMessages.filter(
        (msg): msg is { role: 'user' | 'assistant'; content: string } =>
          (msg.role === 'user' || msg.role === 'assistant') && msg.content.length > 0,
      ),
    )

    activeRequestIdRef.current = null
    toolMessageIndexByIdRef.current = {}
    toolStatusByIdRef.current = {}
    lastStreamEventAtRef.current = 0
    activeAssistantMessageIndexRef.current = null
    activeThoughtMessageIndexRef.current = null
    shouldStartNewThoughtBlockRef.current = false
    cancelRequestedRef.current = false
    clearStreamBuffer(pendingAssistantTextRef, flushTimerRef)
    clearStreamBuffer(pendingThoughtTextRef, thoughtFlushTimerRef)
    setIsAssistantFlushActive(false)
    setIsThoughtFlushActive(false)

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

      const streamStart = await window.argent.ai.streamStart({
        providerId: selectedProvider.id,
        messages: usable,
        cwd,
        model: current.model || selectedProvider.model,
        attachments: retryAttachments,
        modeId: current.acpModeId || undefined,
        sessionId: undefined,
      })

      if (cancelRequestedRef.current) {
        setLoading(false)
        updateTab((prev) => ({
          ...prev,
          isGenerating: false,
        }))
        try {
          await window.argent.ai.streamCancel({ requestId: streamStart.requestId })
        } catch {
          // no-op
        }
        return
      }

      activeRequestIdRef.current = streamStart.requestId
      lastStreamEventAtRef.current = Date.now()
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
        const content = await onSend(
          selectedProvider.id,
          usable,
          cwd,
          current.model || selectedProvider.model,
          retryAttachments,
        )

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
    toolStatusByIdRef.current = {}
    lastStreamEventAtRef.current = 0
    activeAssistantMessageIndexRef.current = null
    activeThoughtMessageIndexRef.current = null
    shouldStartNewThoughtBlockRef.current = false
    clearStreamBuffer(pendingAssistantTextRef, flushTimerRef)
    clearStreamBuffer(pendingThoughtTextRef, thoughtFlushTimerRef)
    setIsAssistantFlushActive(false)
    setIsThoughtFlushActive(false)

    setLoading(false)

    updateTab((current) => {
      const messages = current.messages
        .filter((msg) => !(msg.role === 'assistant' && parseThoughtMessage(msg.content) !== null))
        .map((msg) => {
        if (msg.role === 'assistant') {
          const tool = parseToolMessage(msg.content)
          if (tool && isToolActiveStatus(tool.status)) {
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
      await window.argent.ai.streamCancel({ requestId })
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
        {checkingOpenCodeCli ? (
          <div className="flex h-full min-h-[320px] flex-1 items-center justify-center text-sm text-[#9a9a9a]">
            <div className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-[#bdbdbd]" />
              <span>Checking OpenCode installation...</span>
            </div>
          </div>
        ) : !opencodeInstalled ? (
          <div className="flex h-full min-h-[380px] flex-1 items-center justify-center">
            <div className="w-full max-w-[620px] text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white/5 text-[#d8d8d8] ring-1 ring-white/10">
                <ProviderGlyph providerKey={openCodeProviderKey} className="h-7 w-7 text-[#d8d8d8]" />
              </div>
              <h2 className="mb-0 mt-5 text-[28px] font-semibold tracking-tight text-white">Install OpenCode</h2>
              <p className="mx-auto mb-0 mt-3 max-w-[520px] text-[14px] leading-6 text-[#8e8e8e]">
                Argent uses the OpenCode CLI for AI chat. Install it once and we&apos;ll wire the rest up automatically.
              </p>
              {opencodeInstallMessage ? (
                <div className="mx-auto mt-5 max-w-[520px] rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left text-[13px] text-[#cfcfcf]">
                  {opencodeInstallMessage}
                </div>
              ) : null}
              <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                {(opencodeCliStatus?.installMethods ?? []).map((method, index) => {
                  const isInstalling = installingOpenCodeMethodId === method.id
                  const isPrimary = index === 0
                  return (
                    <button
                      key={method.id}
                      type="button"
                      className={
                        isPrimary
                          ? 'primary-btn h-10 px-4 text-[13px] disabled:cursor-wait disabled:opacity-60'
                          : 'ghost-btn h-10 rounded-xl border border-white/10 px-4 text-[13px] text-[#cfcfcf] hover:text-white disabled:cursor-wait disabled:opacity-60'
                      }
                      onClick={() => {
                        void handleInstallOpenCode(method.id)
                      }}
                      disabled={installingOpenCodeMethodId !== null}
                      title={method.detail}
                    >
                      {isInstalling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : isPrimary ? <Download className="h-3.5 w-3.5" /> : null}
                      <span>{isInstalling ? 'Installing...' : method.label}</span>
                    </button>
                  )
                })}
                <button
                  type="button"
                  className="ghost-btn h-10 rounded-xl border border-white/10 px-4 text-[13px] text-[#cfcfcf] hover:text-white"
                  onClick={() => {
                    void refreshOpenCodeCliStatus()
                  }}
                  disabled={installingOpenCodeMethodId !== null}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span>Refresh</span>
                </button>
              </div>
              {opencodeCliStatus && opencodeCliStatus.installMethods.length === 0 ? (
                <div className="mx-auto mt-6 max-w-[560px] rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-4 text-left">
                  <div className="text-[12px] font-medium uppercase tracking-[0.18em] text-[#767676]">Manual Install</div>
                  <div className="mt-3 space-y-2 font-mono text-[12px] text-[#c8c8c8]">
                    <div>`bun add -g opencode-ai`</div>
                    <div>`npm i -g opencode-ai`</div>
                    <div>`brew install anomalyco/tap/opencode`</div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : tab.messages.length === 0 ? (
          <div className="w-full max-w-[760px] mx-auto mt-10 md:mt-16 px-2 text-center">
            <h2 className="m-0 text-[30px] leading-tight font-semibold tracking-tight text-[#efefef]">
              {spaceKind === 'global' ? 'What do you want to do?' : 'What do you want to build?'}
            </h2>
            <p className="mt-3 mb-0 text-[14px] text-[#9a9a9a]">
              {spaceKind === 'global'
                ? 'I can help across your PC: write code, run terminal tasks, inspect files, troubleshoot issues, or just chat through ideas.'
                : 'Describe an app, feature, bug fix, or refactor and I can plan and execute it.'}
            </p>
          </div>
        ) : null}

        {opencodeInstalled ? tab.messages.map((message, index) => (
          (() => {
            const parsedTool = message.role === 'assistant' ? parseToolMessage(message.content) : null
            const parsedThought = message.role === 'assistant' ? parseThoughtMessage(message.content) : null
            const parsedPlan = message.role === 'assistant' ? parsePlanMessage(message.content) : null
            const userImageAttachments =
              message.role === 'user'
                ? (message.attachments ?? []).filter((attachment) => attachment.kind === 'image')
                : []
            const hideAttachmentSummaryText =
              message.role === 'user' &&
              userImageAttachments.length > 0 &&
              /^Attached\s+\d+\s+item/i.test((message.content || '').trim())
            let hasLaterVisibleMessage = false
            if (parsedTool && isToolActiveStatus(parsedTool.status)) {
              for (let nextIndex = index + 1; nextIndex < tab.messages.length; nextIndex += 1) {
                const nextMessage = tab.messages[nextIndex]
                if (nextMessage.role !== 'assistant') {
                  hasLaterVisibleMessage = true
                  break
                }

                const nextTool = parseToolMessage(nextMessage.content)
                if (nextTool) {
                  const nextToolStatus = normalizeToolDisplayStatus(nextTool.status, loading)
                  if (!isToolActiveStatus(nextToolStatus) || nextTool.kind !== parsedTool.kind || nextTool.title !== parsedTool.title) {
                    hasLaterVisibleMessage = true
                    break
                  }
                  continue
                }

                if (parsePlanMessage(nextMessage.content)) {
                  continue
                }

                hasLaterVisibleMessage = true
                break
              }
            }

            const toolData = parsedTool ? {
              ...parsedTool,
              status: resolveRenderedToolStatus(parsedTool.status, loading, hasLaterVisibleMessage),
            } : null

            if (toolData) {
              const isCompacting = toolData.kind === 'session' && toolData.title.trim().toLowerCase() === 'compacting...'
              const isTodoTool = /\btodos?\b/i.test(toolData.title)
              const todoEntries = parseTodoEntriesFromDetail(toolData.detail)
              return (
                <div key={index} className="mr-auto w-full max-w-full py-0.5">
                  <div className="flex max-w-full items-start gap-2.5 py-1 text-[13px]">
                    <span className="text-[#8bb4ff] flex shrink-0 items-center justify-center">
                      {isCompacting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : toolKindIcon(toolData.kind)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className={isCompacting ? 'ai-compacting-shimmer truncate font-medium' : 'truncate text-[#cccccc]'}>{toolData.title}</div>
                      {todoEntries ? (
                        <div className="mt-1 space-y-1 text-[12px] text-[#9a9a9a]">
                          {todoEntries.map((entry, todoIndex) => (
                            <div key={`${entry.content}-${todoIndex}`} className="flex items-start justify-between gap-2">
                              <div className="min-w-0 truncate text-[#bdbdbd]">{entry.content}</div>
                              <div className="shrink-0 text-[11px] text-[#8d8d8d]">{planStatusLabel(entry.status)}</div>
                            </div>
                          ))}
                        </div>
                      ) : isTodoTool ? null : toolData.detail ? (
                        <div className="truncate text-[11px] text-[#7d7d7d]">{toolData.detail}</div>
                      ) : null}
                    </div>
                    <span className={`text-[12px] flex items-center gap-1.5 ${
                      toolData.status === 'failed' ? 'text-red-400' :
                      (toolData.status === 'in_progress' || toolData.status === 'running') ? 'text-blue-400' :
                      toolData.status === 'completed' ? 'text-[#878787]' :
                      'text-[#707070]'
                    }`}>
                      {(toolData.status === 'in_progress' || toolData.status === 'running') && !isCompacting ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                      {toolStatusLabel(toolData.status)}
                    </span>
                  </div>
                </div>
              )
            }

            if (parsedThought !== null) {
              const isStreamingThought =
                isThoughtFlushActive &&
                index === lastAssistantThoughtIndex &&
                !shouldStartNewThoughtBlockRef.current &&
                (activeAssistantMessageIndexRef.current === null || index > activeAssistantMessageIndexRef.current)
              return (
                <div key={index} className={`mr-auto w-full max-w-full py-1 ${isStreamingThought ? '' : 'ai-message-enter'}`}>
                  <blockquote className={`ai-thinking-block m-0 border-l-2 border-white/15 bg-white/[0.04] px-3 py-2 text-[13px] italic text-[#8f8f8f] ${isStreamingThought ? 'ai-thinking-active' : ''}`}>
                    {isStreamingThought ? (
                      <span className="ai-thinking-stream whitespace-pre-wrap break-words leading-6 text-[#9d9d9d]">
                        {parsedThought}
                        <span className="ai-stream-caret" aria-hidden="true" />
                      </span>
                    ) : (
                      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={markdownComponents}>
                        {normalizeMarkdownSpacing(parsedThought)}
                      </ReactMarkdown>
                    )}
                  </blockquote>
                </div>
              )
            }

            if (parsedPlan && parsedPlan.length > 0) {
              return null
            }

            return (
          <div
            key={index}
            className={
              message.role === 'user'
                ? 'ml-auto flex max-w-[75%] flex-col items-end gap-2 py-1'
                : 'group py-1 px-0 border-none mr-auto bg-transparent text-[#b6b6b6] w-full max-w-full'
            }
          >
            {message.role === 'assistant' ? (
              <div>
                <div className="prose prose-invert max-w-none prose-p:my-2 prose-p:leading-7 prose-headings:my-2 prose-strong:text-[#efefef] prose-em:text-[#d6d6d6] prose-code:text-[#d9d9d9] prose-pre:bg-[#111111]/90 prose-pre:border prose-pre:border-white/10 prose-pre:rounded-xl prose-blockquote:border-l-white/25 prose-blockquote:text-[#c9c9c9] prose-table:my-3 prose-table:w-full prose-th:border prose-th:border-white/20 prose-th:px-2 prose-th:py-1 prose-td:border prose-td:border-white/15 prose-td:px-2 prose-td:py-1 prose-hr:border-white/15">
                  <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={markdownComponents}>
                    {normalizeMarkdownSpacing(
                      isStreamingUi && index === activeAssistantMessageIndexRef.current && (message.content || '').trim().length > 0
                        ? `${message.content || ''}▌`
                        : message.content || '',
                    )}
                  </ReactMarkdown>
                  {isStreamingUi && index === activeAssistantMessageIndexRef.current && (message.content || '').trim().length === 0 ? (
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
                      !parseThoughtMessage(tab.messages[i].content) &&
                      !parsePlanMessage(tab.messages[i].content)
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
                            void copyToClipboard(message.content || '', index)
                          }}
                        >
                          {copiedMessageIndex === index ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                          {copiedMessageIndex === index ? 'Copied' : 'Copy'}
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
                      <span className="inline-flex max-w-full items-center gap-1.5 truncate pl-3 text-[#7d7d7d]">
                        <ProviderGlyph providerKey={assistantModelLabel.providerKey} className="h-3.5 w-3.5 text-[#8f8f8f]" />
                        <span className="truncate">{assistantModelLabel.modelName}</span>
                      </span>
                    </div>
                  )
                })()}
              </div>
            ) : (
              <>
                {userImageAttachments.length > 0 ? (
                  <div className="flex flex-wrap justify-end gap-2">
                    {userImageAttachments.map((attachment) => {
                      const previewSrc = getAttachmentPreviewSrc(attachment)
                      if (!previewSrc) {
                        return null
                      }

                      return (
                        <div key={attachment.id} className="h-24 w-24 overflow-hidden rounded-2xl border border-white/10 bg-[#1d1d1d]">
                          <img src={previewSrc} alt={attachment.name} className="h-full w-full object-cover" />
                        </div>
                      )
                    })}
                  </div>
                ) : null}

                {!hideAttachmentSummaryText ? (
                  <div className="border-none bg-white/12 shadow-sm ring-1 ring-white/10 rounded-2xl px-4 py-2.5 text-white whitespace-pre-wrap">
                    {message.content}
                  </div>
                ) : null}
              </>
            )}
          </div>
            )
          })()
        )) : null}

        {opencodeInstalled && isStreamingUi && lastAssistantTextIndex === -1 ? (
          <div className="py-1 px-0 border-none mr-auto bg-transparent text-[#b6b6b6] w-full max-w-full">
            <span className="inline-block animate-pulse text-[#f0f0f0]">▌</span>
          </div>
        ) : null}
      </div>

      {opencodeInstalled ? (
      <form
        className="absolute bottom-0 left-0 right-0 z-20 w-full px-5 md:px-12 lg:px-24 pb-5 [-webkit-app-region:no-drag]"
        onSubmit={(event) => {
          event.preventDefault()
          void handleSend()
        }}
      >
        <div
          className={`flex flex-col w-full rounded-3xl border transition px-1 bg-[#151515]/96 text-[#e5e5e5] shadow-[0_20px_55px_rgba(0,0,0,0.5)] ${isComposerDragging ? 'border-[#9ac1ff] bg-[#1a1a1a]' : 'border-white/20 hover:border-white/30 focus-within:border-white/40'}`}
          dir="auto"
          onDragOver={(event) => {
            if (!Array.from(event.dataTransfer?.types ?? []).includes('Files')) {
              return
            }
            event.preventDefault()
            if (!isComposerDragging) {
              setIsComposerDragging(true)
            }
          }}
          onDragLeave={(event) => {
            const related = event.relatedTarget
            if (related instanceof Node && event.currentTarget.contains(related)) {
              return
            }
            if (isComposerDragging) {
              setIsComposerDragging(false)
            }
          }}
          onDrop={(event) => {
            void handleDrop(event)
          }}
        >
          <div className="px-2.5">
            {isComposerDragging ? (
              <div className="px-1 pt-2 text-[11px] text-[#9ac1ff]">Drop files or images to attach</div>
            ) : null}

            {composerAttachments.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2 px-1 pt-2 pb-1.5">
                {composerAttachments.map((attachment) => {
                  const label = attachment.kind === 'image' ? `Image: ${attachment.name}` : attachment.name
                  const previewSrc = getAttachmentPreviewSrc(attachment)
                  const removeAttachment = () => {
                    updateTab((current) => ({
                      ...current,
                      attachments: (current.attachments ?? []).filter((item) => item.id !== attachment.id),
                    }))
                  }

                  if (previewSrc) {
                    return (
                      <div key={attachment.id} className="relative h-20 w-20 overflow-hidden rounded-2xl border border-[#3a3a3a] bg-[#1a1a1a]">
                        <img src={previewSrc} alt={attachment.name} className="h-full w-full object-cover" />
                        <button
                          type="button"
                          className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-black/65 text-[#f0f0f0] transition hover:bg-black/80"
                          onClick={removeAttachment}
                          aria-label={`Remove ${attachment.name}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )
                  }

                  return (
                    <div key={attachment.id} className="inline-flex max-w-full items-center gap-1.5 rounded-2xl border border-[#3a3a3a] bg-[#1a1a1a] px-1.5 py-1 text-[11px] text-[#d0d0d0]">
                      <div className="grid h-8 w-8 place-items-center rounded-lg bg-[#222222]">
                        <FileText className="h-3.5 w-3.5 shrink-0 text-[#9a9a9a]" />
                      </div>
                      <span className="truncate max-w-[180px]">{label}</span>
                      <button
                        type="button"
                        className="rounded-full px-1 text-[#9a9a9a] hover:bg-white/10 hover:text-[#e0e0e0]"
                        onClick={removeAttachment}
                        aria-label={`Remove ${attachment.name}`}
                      >
                        ×
                      </button>
                    </div>
                  )
                })}
              </div>
            ) : null}

            <textarea
              className="w-full bg-transparent outline-none border-0 resize-none text-[15px] text-[#ebebeb] placeholder:text-[#7f7f7f] pt-2.5 pb-[6px] px-1 min-h-[72px] max-h-72 overflow-auto"
              value={tab.input}
              onChange={(event) => updateTab((current) => ({ ...current, input: event.target.value }))}
              onPaste={(event) => {
                void handlePaste(event)
              }}
              onKeyDown={(event) => {
                if (slashCommandMenuOpen && slashCommandSuggestions.length > 0) {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault()
                    setCommandMenuIndex((prev) => (prev + 1) % slashCommandSuggestions.length)
                    return
                  }

                  if (event.key === 'ArrowUp') {
                    event.preventDefault()
                    setCommandMenuIndex((prev) => (prev - 1 + slashCommandSuggestions.length) % slashCommandSuggestions.length)
                    return
                  }

                  if ((event.key === 'Tab' || event.key === 'Enter') && !event.shiftKey) {
                    event.preventDefault()
                    const selected = slashCommandSuggestions[commandMenuIndex] ?? slashCommandSuggestions[0]
                    if (selected) {
                      applySlashCommand(selected.name)
                    }
                    return
                  }
                }

                if (event.key !== 'Enter' || event.shiftKey) {
                  return
                }

                event.preventDefault()
                if (!loading && opencodeInstalled && (tab.input.trim().length > 0 || (tab.attachments?.length ?? 0) > 0)) {
                  void handleSend()
                }
              }}
              placeholder={opencodeInstalled ? 'Ask Argent anything, @ to add files, / for commands' : 'Install OpenCode CLI to enable AI chat'}
              rows={3}
            />

            {slashCommandMenuOpen ? (
              <div className="mb-2 max-h-52 overflow-auto rounded-xl border border-[#2f2f2f] bg-[#111111]/95 p-1">
                {slashCommandSuggestions.map((command, index) => {
                  const isActive = index === commandMenuIndex
                  return (
                    <button
                      key={command.name}
                      type="button"
                      className={`w-full rounded-lg px-2.5 py-2 text-left transition-colors ${isActive ? 'bg-white/12 text-[#f0f0f0]' : 'text-[#c5c5c5] hover:bg-white/8'}`}
                      onMouseEnter={() => setCommandMenuIndex(index)}
                      onClick={() => applySlashCommand(command.name)}
                    >
                      <div className="text-[13px] font-medium">/{command.name}</div>
                      {command.description ? <div className="mt-0.5 truncate text-[11px] text-[#8d8d8d]">{command.description}</div> : null}
                    </button>
                  )
                })}
              </div>
            ) : null}
          </div>

          <div className="flex items-center justify-between mb-2.5 mx-1 border-t border-[#2c2c2c] pt-2">
            <div className="flex items-center gap-1.5">
              <div className="relative flex items-center" ref={modelMenuRef}>
                {isLoadingOpenCodeMeta ? (
                  <div className="inline-flex items-center gap-1.5 px-2 py-1.5 text-sm text-[#878787]">
                    <ProviderGlyph
                      providerKey={extractModelMeta('OpenCode/loading', 'opencode/loading', 'opencode').providerKey}
                      className="h-3.5 w-3.5 text-[#bdbdbd]"
                    />
                    <span className="ai-compacting-shimmer tracking-[0.02em]">Loading OpenCode</span>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      className="rounded-lg px-2 py-1.5 text-sm text-[#878787] outline-none hover:bg-white/8 hover:text-[#d0d0d0] inline-flex items-center gap-1.5 w-auto justify-between transition-colors duration-200"
                      onClick={() => setModelMenuOpen((prev) => !prev)}
                      aria-haspopup="listbox"
                      aria-expanded={modelMenuOpen}
                    >
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                        <ProviderGlyph providerKey={selectedModelMeta.providerKey} className="h-3.5 w-3.5 text-[#bdbdbd]" />
                        <span>{selectedModelMeta.modelName}</span>
                      </span>
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>

                    <div className="relative" ref={modeMenuRef}>
                      <button
                        type="button"
                        className="rounded-lg px-2 py-1.5 text-sm text-[#878787] outline-none hover:bg-white/8 hover:text-[#d0d0d0] inline-flex items-center gap-1.5 w-auto justify-between transition-colors duration-200"
                        onClick={() => setActiveMetaPopover((prev) => (prev === 'access' ? null : 'access'))}
                        aria-haspopup="listbox"
                        aria-expanded={activeMetaPopover === 'access'}
                      >
                        <span>{modeLabel}</span>
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>

                      {activeMetaPopover === 'access' ? (
                        <div className="absolute left-0 bottom-[calc(100%+8px)] w-[280px] max-w-[70vw] rounded-xl border border-[#363636] bg-[#181818] p-1.5 shadow-[0_16px_40px_rgba(0,0,0,0.45)] z-40" role="listbox">
                          <div className="grid gap-1">
                            {modeOptions.length > 0 ? modeOptions.map((mode) => {
                              const active = mode.id === selectedModeId
                              return (
                                <button
                                  key={mode.id}
                                  type="button"
                                  className={`w-full rounded-lg px-2.5 py-2 text-left transition-colors ${active ? 'bg-white/12 text-[#efefef]' : 'text-[#c4c4c4] hover:bg-[#2a2a2a]'}`}
                                  onClick={() => selectMode(mode)}
                                >
                                  <div className="text-[13px] font-medium">{displayModeName(mode)}</div>
                                  {mode.description ? <div className="mt-0.5 text-[11px] text-[#898989]">{mode.description}</div> : null}
                                </button>
                              )
                            }) : (
                              <div className="px-2.5 py-2 text-[12px] text-[#8f8f8f]">Modes unavailable</div>
                            )}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </>
                )}

                <button type="button" className="bg-transparent hover:bg-white/8 text-[#b8b8b8] transition rounded-full p-1.5 outline-none" onClick={addFileAttachment} aria-label="Add file">
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
                                              selectModel(selectedVariant.id)
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
                                                    selectModel(variant.id)
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
              {!isLoadingOpenCodeMeta ? (() => {
                const limit = resolvedContextWindow ?? 0
                const validLimit = limit > 0
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
                          className={
                            !validLimit
                              ? 'stroke-[#6b6b6b]'
                              : percentage > 90
                                ? 'stroke-[#ef4444]'
                                : percentage > 75
                                  ? 'stroke-[#eab308]'
                                  : 'stroke-[#b5b5b5]'
                          }
                          strokeDasharray={circumference} 
                          strokeDashoffset={validLimit ? strokeDashoffset : circumference}
                          strokeLinecap="round" 
                        />
                      </svg>
                    </button>
                    {activeMetaPopover === 'context' ? (
                      <div className="absolute right-0 bottom-[calc(100%+8px)] w-[250px] rounded-xl border border-[#353535] bg-[#161616] px-3.5 py-3 text-[12px] leading-relaxed shadow-[0_14px_30px_rgba(0,0,0,0.45)] z-40 text-left" role="status">
                        <div className="font-medium text-[#c0c0c0] mb-0.5">Context window</div>
                        {validLimit ? (
                          <>
                            <div className="font-medium text-[#e0e0e0] text-[13px] mb-1">
                              {percentage.toFixed(1)}% used <span className="text-[#888] font-normal">({(100 - percentage).toFixed(1)}% left)</span>
                            </div>
                            <div className="text-[#888]">
                              {(usedTokens / 1000).toFixed(1)}k / {(limit / 1000).toFixed(1)}k tokens used
                            </div>
                          </>
                        ) : (
                          <div className="text-[#888]">Token limit is unavailable for the current model.</div>
                        )}
                      </div>
                    ) : null}
                  </div>
                )
              })() : null}

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
                  disabled={!opencodeInstalled || (tab.input.trim().length === 0 && (tab.attachments?.length ?? 0) === 0)}
                >
                  <SendHorizontal className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      </form>
      ) : null}
    </section>
  )
}
