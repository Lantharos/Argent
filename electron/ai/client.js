import { chatRequestSchema } from './schema.js'
import { getProviderSecret, listProviders } from '../store/providersStore.js'
import fs from 'node:fs'
import path from 'node:path'
import { exec, spawn, spawnSync } from 'node:child_process'
import { promisify } from 'node:util'
import readline from 'node:readline'

const execAsync = promisify(exec)
let copilotRuntimePromise = null
const openCodeRuntimeByCwd = new Map()
const MODEL_CACHE_TTL_MS = 5 * 60 * 1000

function commandExists(command) {
  const checker = process.platform === 'win32' ? 'where' : 'which'
  const probe = spawnSync(checker, [command], {
    windowsHide: true,
    stdio: 'ignore',
  })
  return probe.status === 0
}

function spawnCliProcess(command, args, options = {}) {
  const useShell = process.platform === 'win32'
  return spawn(command, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    shell: useShell,
    ...options,
  })
}

function createJsonRpcConnection(proc, requestTimeoutMs = 120000) {
  const rl = readline.createInterface({ input: proc.stdout })
  let nextId = 1
  const pending = new Map()
  const notifications = new Set()

  const send = (payload) => {
    if (!proc.stdin.destroyed) {
      proc.stdin.write(`${JSON.stringify(payload)}\n`)
    }
  }

  const request = (method, params = {}) => {
    const id = nextId
    nextId += 1

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`Timed out waiting for ${method}`))
      }, requestTimeoutMs)

      pending.set(id, {
        resolve: (result) => {
          clearTimeout(timer)
          resolve(result)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        },
      })

      send({ method, id, params })
    })
  }

  const notify = (method, params = {}) => {
    send({ method, params })
  }

  const onNotification = (handler) => {
    notifications.add(handler)
    return () => notifications.delete(handler)
  }

  rl.on('line', (line) => {
    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      return
    }

    if (typeof msg.id === 'number' && pending.has(msg.id)) {
      const waiter = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) {
        waiter.reject(new Error(msg.error.message || 'JSON-RPC error'))
      } else {
        waiter.resolve(msg.result)
      }
      return
    }

    if (typeof msg.method === 'string') {
      for (const listener of notifications) {
        listener(msg)
      }
    }
  })

  const rejectPending = (error) => {
    for (const waiter of pending.values()) {
      waiter.reject(error)
    }
    pending.clear()
  }

  proc.once('error', (error) => {
    rejectPending(error)
  })

  proc.once('exit', (code, signal) => {
    if (pending.size > 0) {
      rejectPending(new Error(`JSON-RPC process exited (code=${code}, signal=${signal ?? 'none'})`))
    }
  })

  return {
    request,
    notify,
    onNotification,
    close: () => {
      rl.close()
      if (!proc.killed) {
        proc.kill()
      }
    },
  }
}

function asPositiveNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.trim())
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed
    }
  }
  return null
}

function asNonNegativeNumber(value) {
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

function normalizeAcpUsageSnapshot(value) {
  if (!value || typeof value !== 'object') {
    return null
  }

  const usage = value
  const lastTokenUsage = usage.last_token_usage && typeof usage.last_token_usage === 'object'
    ? usage.last_token_usage
    : usage.lastTokenUsage && typeof usage.lastTokenUsage === 'object'
      ? usage.lastTokenUsage
      : null

  const used =
    asNonNegativeNumber(usage.used) ??
    asNonNegativeNumber(usage.total_tokens ?? usage.totalTokens) ??
    asNonNegativeNumber(lastTokenUsage?.total_tokens ?? lastTokenUsage?.totalTokens)

  const size =
    asNonNegativeNumber(usage.size) ??
    asNonNegativeNumber(usage.model_context_window ?? usage.modelContextWindow)

  if (used === null && size === null) {
    return null
  }

  return {
    total_tokens: used,
    model_context_window: size,
    last_token_usage: used === null
      ? undefined
      : {
          total_tokens: used,
        },
  }
}

function normalizeAvailableCommands(value) {
  if (!Array.isArray(value)) {
    return []
  }

  const normalized = value
    .map((item) => {
      const name = typeof item?.name === 'string' ? item.name.trim() : ''
      const description = typeof item?.description === 'string' ? item.description.trim() : ''
      return {
        name,
        description,
      }
    })
    .filter((item) => item.name.length > 0)

  return Array.from(new Map(normalized.map((item) => [item.name, item])).values())
}

function normalizeAvailableModes(value) {
  if (!Array.isArray(value)) {
    return []
  }

  const normalized = value
    .map((item) => {
      const id = typeof item?.id === 'string' ? item.id.trim() : ''
      const name = typeof item?.name === 'string' ? item.name.trim() : id
      const description = typeof item?.description === 'string' ? item.description.trim() : ''
      return {
        id,
        name: name || id,
        description,
      }
    })
    .filter((item) => item.id.length > 0)

  return Array.from(new Map(normalized.map((item) => [item.id, item])).values())
}

function resolveModelContextWindow(item) {
  const limits = item?.limits && typeof item.limits === 'object' ? item.limits : null
  const candidates = [
    item?.contextWindow,
    item?.contextWindowTokens,
    item?.maxInputTokens,
    item?.modelContextWindow,
    item?.model_context_window,
    item?.contextWindowTokenLimit,
    item?.context_window,
    item?.contextLength,
    item?.context_length,
    item?.maxTokens,
    item?.max_tokens,
    item?.tokenLimit,
    item?.token_limit,
    item?.inputTokenLimit,
    item?.input_token_limit,
    limits?.context,
    limits?.contextWindow,
    limits?.context_window,
    limits?.maxInputTokens,
  ]

  for (const candidate of candidates) {
    const parsed = asPositiveNumber(candidate)
    if (parsed !== null) {
      return parsed
    }
  }

  return null
}

function parseSlashCommand(text) {
  if (typeof text !== 'string') {
    return null
  }

  const trimmed = text.trim()
  if (!trimmed.startsWith('/')) {
    return null
  }

  const [name, ...rest] = trimmed.slice(1).split(/\s+/)
  const normalized = typeof name === 'string' ? name.trim() : ''
  if (!normalized) {
    return null
  }

  return {
    name: normalized.toLowerCase(),
    args: rest.join(' ').trim(),
  }
}

function isCopilotRuntimeExitError(error) {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('Client not connected') || message.includes('CLI server exited with code 0')
}

function isOpenCodeRuntimeExitError(error) {
  const message = error instanceof Error ? error.message : String(error)
  return (
    message.includes('JSON-RPC process exited') ||
    message.includes('EPIPE') ||
    message.includes('write after end') ||
    message.includes('socket hang up')
  )
}

function invalidateOpenCodeRuntime(cwd) {
  const workingDirectory = path.resolve(cwd || process.cwd())
  const runtimePromise = openCodeRuntimeByCwd.get(workingDirectory)
  openCodeRuntimeByCwd.delete(workingDirectory)

  if (runtimePromise) {
    runtimePromise
      .then((runtime) => {
        runtime.rpc.close()
      })
      .catch(() => {
        // no-op
      })
  }
}

async function getOpenCodeRuntime(cwd) {
  if (!commandExists('opencode')) {
    throw new Error('OpenCode CLI was not found in PATH. Install OpenCode to use ACP.')
  }

  const workingDirectory = path.resolve(cwd || process.cwd())
  const existing = openCodeRuntimeByCwd.get(workingDirectory)
  if (existing) {
    return existing
  }

  const runtimePromise = (async () => {
    const proc = spawnCliProcess('opencode', ['acp', '--cwd', workingDirectory], {
      cwd: workingDirectory,
    })
    const rpc = createJsonRpcConnection(proc)

    proc.once('exit', () => {
      if (openCodeRuntimeByCwd.get(workingDirectory) === runtimePromise) {
        openCodeRuntimeByCwd.delete(workingDirectory)
      }
    })

    const initializeResult = await rpc.request('initialize', {
      protocolVersion: 1,
      clientCapabilities: {
        _meta: {
          'terminal-auth': false,
        },
      },
    })

    return {
      cwd: workingDirectory,
      rpc,
      knownSessions: new Set(),
      lastSessionId: null,
      sessionUsageById: new Map(),
      sessionModeById: new Map(),
      availableModels: [],
      availableModelsFetchedAt: 0,
      availableCommands: [],
      availableCommandsBySessionId: new Map(),
      availableModesBySessionId: new Map(),
      capabilities: initializeResult?.agentCapabilities || null,
    }
  })().catch((error) => {
    if (openCodeRuntimeByCwd.get(workingDirectory) === runtimePromise) {
      openCodeRuntimeByCwd.delete(workingDirectory)
    }
    throw error
  })

  openCodeRuntimeByCwd.set(workingDirectory, runtimePromise)
  return runtimePromise
}

async function withOpenCodeRuntime(cwd, task) {
  const workingDirectory = path.resolve(cwd || process.cwd())
  let runtime = await getOpenCodeRuntime(workingDirectory)

  try {
    return await task(runtime)
  } catch (error) {
    if (!isOpenCodeRuntimeExitError(error)) {
      throw error
    }

    invalidateOpenCodeRuntime(workingDirectory)
    runtime = await getOpenCodeRuntime(workingDirectory)
    return task(runtime)
  }
}

function ensureCopilotJsonRpcShim() {
  const candidateRoots = [process.cwd(), path.resolve(process.cwd(), '..')]

  for (const root of candidateRoots) {
    const packageDir = path.join(root, 'node_modules', 'vscode-jsonrpc')
    const nodeJsPath = path.join(packageDir, 'node.js')
    const shimPath = path.join(packageDir, 'node')

    if (!fs.existsSync(nodeJsPath) || fs.existsSync(shimPath)) {
      continue
    }

    try {
      fs.writeFileSync(shimPath, "export * from './node.js';\n", 'utf8')
      return
    } catch {
      // Keep trying other candidate roots.
    }
  }
}

function normalizeEndpoint(endpoint) {
  return endpoint.endsWith('/') ? endpoint.slice(0, -1) : endpoint
}

function isLocalEndpoint(endpoint) {
  return endpoint.startsWith('http://127.0.0.1') || endpoint.startsWith('http://localhost')
}

function asOpenAIRequest(messages, model, temperature) {
  return {
    model,
    messages: messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
    temperature: temperature ?? 0.2,
  }
}

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List files and folders in a directory under the current workspace',
      parameters: {
        type: 'object',
        properties: {
          relativePath: { type: 'string', description: 'Directory path relative to workspace root', default: '.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read text file contents from the workspace',
      parameters: {
        type: 'object',
        properties: {
          relativePath: { type: 'string', description: 'File path relative to workspace root' },
        },
        required: ['relativePath'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write file contents into the workspace and create parent folders when needed',
      parameters: {
        type: 'object',
        properties: {
          relativePath: { type: 'string', description: 'File path relative to workspace root' },
          content: { type: 'string', description: 'Full file contents to write' },
        },
        required: ['relativePath', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Run a shell command in the workspace root',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Command to execute' },
        },
        required: ['command'],
      },
    },
  },
]

function resolveWorkspacePath(cwd, relativePath = '.') {
  const root = path.resolve(cwd || process.cwd())
  const target = path.resolve(root, relativePath)
  const rel = path.relative(root, target)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Path escapes workspace root')
  }
  return { root, target }
}

async function runToolCall(cwd, name, args) {
  if (name === 'list_files') {
    const { target } = resolveWorkspacePath(cwd, args?.relativePath || '.')
    const entries = fs
      .readdirSync(target, { withFileTypes: true })
      .map((entry) => `${entry.isDirectory() ? 'dir' : 'file'} ${entry.name}`)
    return { path: target, entries }
  }

  if (name === 'read_file') {
    const { target } = resolveWorkspacePath(cwd, args?.relativePath)
    const content = fs.readFileSync(target, 'utf8')
    return { path: target, content }
  }

  if (name === 'write_file') {
    const { target } = resolveWorkspacePath(cwd, args?.relativePath)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, args?.content ?? '', 'utf8')
    return { path: target, ok: true }
  }

  if (name === 'run_command') {
    const { root } = resolveWorkspacePath(cwd, '.')
    const { stdout, stderr } = await execAsync(args?.command ?? '', {
      cwd: root,
      windowsHide: true,
      timeout: 120000,
      maxBuffer: 1024 * 1024,
      shell: true,
    })
    return { stdout, stderr }
  }

  throw new Error(`Unknown tool: ${name}`)
}

async function requestCompletion(endpoint, headers, body) {
  const response = await fetch(`${endpoint}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errorBody = await response.text()
    throw new Error(`AI provider request failed (${response.status}): ${errorBody}`)
  }

  return response.json()
}

async function listOpenAICompatibleModels(provider, apiKey) {
  const endpoint = normalizeEndpoint(provider.endpoint)
  const authHeader = apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
  const headers = {
    ...authHeader,
    'Content-Type': 'application/json',
    ...provider.headers,
  }

  const response = await fetch(`${endpoint}/models`, {
    method: 'GET',
    headers,
  })

  if (!response.ok) {
    throw new Error(`Failed to list models (${response.status})`)
  }

  const json = await response.json()
  const data = Array.isArray(json?.data) ? json.data : []

  const mapped = data
    .map((item) => ({
      id: item?.id,
      label: item?.name || item?.id,
    }))
    .filter((item) => Boolean(item.id))

  return Array.from(new Map(mapped.map((item) => [item.id, item])).values())
}

function toTranscript(messages) {
  return messages.map((message) => `${message.role.toUpperCase()}: ${message.content}`).join('\n\n')
}

async function requestViaOpenAICompatible(parsed, provider, apiKey) {
  const endpoint = normalizeEndpoint(provider.endpoint)
  const authHeader = apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
  const headers = {
    ...authHeader,
    'Content-Type': 'application/json',
    ...provider.headers,
  }

  const messages = [...parsed.messages]
  const maxTurns = 8

  for (let turn = 0; turn < maxTurns; turn += 1) {
    const body = {
      ...asOpenAIRequest(messages, parsed.model || provider.model, parsed.temperature),
      tools: TOOLS,
      tool_choice: 'auto',
    }

    const json = await requestCompletion(endpoint, headers, body)
    const message = json?.choices?.[0]?.message
    if (!message) {
      throw new Error('Provider returned no message')
    }

    if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
      messages.push({
        role: 'assistant',
        content: message.content ?? '',
        tool_calls: message.tool_calls,
      })

      for (const call of message.tool_calls) {
        let output
        try {
          const args = call?.function?.arguments ? JSON.parse(call.function.arguments) : {}
          output = await runToolCall(parsed.cwd, call.function.name, args)
        } catch (error) {
          output = { error: String(error instanceof Error ? error.message : error) }
        }

        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(output),
        })
      }
      continue
    }

    const content = message.content
    if (typeof content !== 'string' || content.length === 0) {
      throw new Error('Provider returned empty content')
    }

    return {
      id: json?.id ?? null,
      content,
      model: json?.model ?? parsed.model ?? provider.model,
      usage: json?.usage ?? null,
    }
  }

  throw new Error('Model exceeded tool-call turn limit without final response')
}

async function requestViaCodexAppServer(parsed, provider, emitEvent = () => {}) {
  if (!commandExists('codex')) {
    throw new Error('Codex CLI was not found in PATH. Install Codex to use Codex App Server.')
  }

  const workingDirectory = parsed.cwd || process.cwd()
  const proc = spawnCliProcess('codex', ['app-server'], {
    cwd: workingDirectory,
  })
  const rpc = createJsonRpcConnection(proc)
  let assistantText = ''
  let activeTurnId = null
  let completedTurnPayload = null

  const extractAssistantTextFromTurn = (turn) => {
    const items = Array.isArray(turn?.items) ? turn.items : []
    for (const item of items) {
      if (item?.type === 'agentMessage') {
        if (typeof item?.text === 'string' && item.text.trim().length > 0) {
          return item.text
        }
        const content = Array.isArray(item?.content) ? item.content : []
        const textParts = content
          .map((part) => (typeof part?.text === 'string' ? part.text : ''))
          .filter(Boolean)
        if (textParts.length > 0) {
          return textParts.join('')
        }
      }
    }
    return ''
  }

  const stopListening = rpc.onNotification((msg) => {
    if (msg.method === 'turn/started') {
      activeTurnId = msg?.params?.turn?.id ?? activeTurnId
    }

    if (msg.method === 'item/agentMessage/delta') {
      const delta = msg?.params?.delta ?? msg?.params?.text ?? msg?.params?.data?.deltaContent
      if (typeof delta === 'string') {
        assistantText += delta
        emitEvent({ type: 'text-delta', delta })
      }
    }

    if (msg.method === 'item/started') {
      const item = msg?.params?.item
      const itemType = item?.type
      if (itemType === 'commandExecution' || itemType === 'fileChange' || itemType === 'mcpToolCall') {
        emitEvent({
          type: 'tool',
          id: item?.id || null,
          status: 'pending',
          kind: itemType,
          title: itemType === 'fileChange' ? 'Edit file' : itemType === 'commandExecution' ? 'Run command' : 'MCP tool',
        })
      }
    }

    if (msg.method === 'item/completed' && msg?.params?.item?.type === 'agentMessage') {
      const text = msg?.params?.item?.text
      if (typeof text === 'string' && text.length > assistantText.length) {
        assistantText = text
      }
    }

    if (msg.method === 'item/completed') {
      const item = msg?.params?.item
      const itemType = item?.type
      if (itemType === 'commandExecution' || itemType === 'fileChange' || itemType === 'mcpToolCall') {
        emitEvent({
          type: 'tool',
          id: item?.id || null,
          status: 'completed',
          kind: itemType,
          title: itemType === 'fileChange' ? 'Edit file' : itemType === 'commandExecution' ? 'Run command' : 'MCP tool',
        })
      }
    }

    if (msg.method === 'turn/completed') {
      completedTurnPayload = msg?.params?.turn ?? null
    }
  })

  const stderrChunks = []
  proc.stderr.on('data', (chunk) => stderrChunks.push(chunk.toString()))

  try {
    await rpc.request('initialize', {
      clientInfo: {
        name: 'opensmith',
        title: 'OpenSmith',
        version: '0.1.0',
      },
      capabilities: {
        experimentalApi: true,
      },
    })
    rpc.notify('initialized', {})

    const threadResult = await rpc.request('thread/start', {
      model: parsed.model || provider.model,
      cwd: workingDirectory,
      approvalPolicy: 'never',
      sandboxPolicy: {
        type: 'workspaceWrite',
        writableRoots: [workingDirectory],
        networkAccess: true,
      },
    })

    const threadId = threadResult?.thread?.id
    if (!threadId) {
      throw new Error('Codex app-server returned no thread id')
    }

    const transcript = toTranscript(parsed.messages)
    await rpc.request('turn/start', {
      threadId,
      cwd: workingDirectory,
      model: parsed.model || provider.model,
      input: [{ type: 'text', text: transcript }],
      approvalPolicy: 'never',
      sandboxPolicy: {
        type: 'workspaceWrite',
        writableRoots: [workingDirectory],
        networkAccess: true,
      },
    })

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timed out waiting for Codex turn completion')), 180000)
      const stop = rpc.onNotification((msg) => {
        if (msg.method === 'turn/completed') {
          const doneTurnId = msg?.params?.turn?.id
          if (!activeTurnId || !doneTurnId || doneTurnId === activeTurnId) {
            clearTimeout(timeout)
            stop()
            resolve(true)
          }
        }
      })
    })

    if (!assistantText.trim() && completedTurnPayload) {
      assistantText = extractAssistantTextFromTurn(completedTurnPayload)
      if (assistantText.trim()) {
        emitEvent({ type: 'text-delta', delta: assistantText })
      }
    }

    const content = assistantText.trim()
    if (!content) {
      throw new Error(`Codex app-server returned no final text. ${stderrChunks.join('')}`)
    }

    return {
      id: null,
      content,
      model: parsed.model || provider.model,
      usage: null,
    }
  } finally {
    stopListening()
    rpc.close()
  }
}

async function requestViaOpenCodeAcp(parsed, provider, emitEvent = () => {}, options = {}) {
  const { abortSignal } = options
  const workingDirectory = parsed.cwd || process.cwd()
  return withOpenCodeRuntime(workingDirectory, async (runtime) => {
    const rpc = runtime.rpc
    let assistantText = ''
    let aborted = false
    let activeSessionId = null
    let latestUsage = null
    const toolStatusById = new Map()

    const STATUS_ORDER = {
      pending: 1,
      in_progress: 2,
      completed: 3,
      failed: 3,
    }

    const normalizeToolStatus = (update) => {
      const raw = typeof update?.status === 'string' ? update.status : null
      if (raw === 'pending' || raw === 'in_progress' || raw === 'completed' || raw === 'failed') {
        return raw
      }
      if (update?.sessionUpdate === 'tool_call') {
        return 'pending'
      }
      return 'in_progress'
    }

    const handleAbort = () => {
      aborted = true
      if (activeSessionId) {
        rpc.notify('session/cancel', { sessionId: activeSessionId })
      }
    }

    if (abortSignal?.aborted) {
      handleAbort()
    } else if (abortSignal) {
      abortSignal.addEventListener('abort', handleAbort, { once: true })
    }

    const pickToolTitle = (update) => {
      const label =
        update?.title ||
        update?.toolName ||
        update?.name ||
        update?.tool?.name ||
        update?.kind ||
        'Tool call'
      return typeof label === 'string' && label.trim().length > 0 ? label : 'Tool call'
    }

    const pickToolDetail = (update) => {
      const candidates = [
        update?.description,
        update?.message,
        update?.command,
        update?.path,
        update?.args && Array.isArray(update.args) ? update.args.join(' ') : null,
        update?.toolInput && typeof update.toolInput === 'object' ? JSON.stringify(update.toolInput) : null,
      ]
      const detail = candidates.find((value) => typeof value === 'string' && value.trim().length > 0)
      if (!detail) {
        return null
      }
      return detail.length > 180 ? `${detail.slice(0, 180)}...` : detail
    }

    const stopListening = rpc.onNotification((msg) => {
      if (msg.method !== 'session/update') {
        return
      }

      const updateSessionId = msg?.params?.sessionId
      const update = msg?.params?.update
      if (update?.sessionUpdate === 'available_commands_update') {
        const commands = normalizeAvailableCommands(update?.availableCommands)
        if (commands.length > 0) {
          runtime.availableCommands = commands
          if (typeof updateSessionId === 'string' && updateSessionId.length > 0) {
            runtime.availableCommandsBySessionId.set(updateSessionId, commands)
          }
          emitEvent({ type: 'commands', commands })
        }
        return
      }

      if (!activeSessionId || updateSessionId !== activeSessionId) {
        return
      }

      if (update?.sessionUpdate === 'agent_message_chunk') {
        const text = update?.content?.text
        if (typeof text === 'string') {
          assistantText += text
          emitEvent({ type: 'text-delta', delta: text })
        }
        return
      }

      if (update?.sessionUpdate === 'agent_thought_chunk') {
        const text = update?.content?.text
        if (typeof text === 'string') {
          emitEvent({ type: 'thought-delta', delta: text })
        }
        return
      }

      if (update?.sessionUpdate === 'tool_call' || update?.sessionUpdate === 'tool_call_update') {
        const toolId = update?.toolCallId || null
        const normalizedStatus = normalizeToolStatus(update)
        if (toolId) {
          const prev = toolStatusById.get(toolId)
          if (prev && STATUS_ORDER[normalizedStatus] < STATUS_ORDER[prev]) {
            return
          }
          toolStatusById.set(toolId, normalizedStatus)
        }

        emitEvent({
          type: 'tool',
          id: toolId,
          status: normalizedStatus,
          kind: update?.kind || 'other',
          title: pickToolTitle(update),
          detail: pickToolDetail(update),
        })
        return
      }

      if (update?.sessionUpdate === 'usage_update') {
        const normalized = normalizeAcpUsageSnapshot(update)
        if (normalized) {
          latestUsage = normalized
          if (activeSessionId) {
            runtime.sessionUsageById.set(activeSessionId, normalized)
          }
        }
        return
      }

      if (update?.sessionUpdate === 'compacting' || update?.sessionUpdate === 'compaction_update') {
        const status = typeof update?.status === 'string' ? update.status : 'in_progress'
        emitEvent({
          type: 'tool',
          id: 'session-compact',
          status,
          kind: 'session',
          title: 'Compacting...',
          detail: typeof update?.message === 'string' ? update.message : 'Compressing conversation context',
        })
      }
    })

    try {
      if (aborted) {
        throw new Error('Generation cancelled')
      }

      let sessionResult = null
      let resumedSession = false
      if (parsed.sessionId) {
        if (runtime.knownSessions.has(parsed.sessionId)) {
          sessionResult = { sessionId: parsed.sessionId }
          resumedSession = true
        } else {
          const canResume = Boolean(runtime?.capabilities?.sessionCapabilities?.resume)
          try {
            if (canResume) {
              sessionResult = await rpc.request('session/resume', {
                sessionId: parsed.sessionId,
                cwd: workingDirectory,
                mcpServers: [],
              })
            } else {
              sessionResult = await rpc.request('session/load', {
                sessionId: parsed.sessionId,
                cwd: workingDirectory,
                mcpServers: [],
              })
            }
          } catch {
            if (canResume) {
              try {
                sessionResult = await rpc.request('session/load', {
                  sessionId: parsed.sessionId,
                  cwd: workingDirectory,
                  mcpServers: [],
                })
              } catch {
                sessionResult = null
              }
            } else {
              sessionResult = null
            }
          }

          if (sessionResult) {
            runtime.knownSessions.add(parsed.sessionId)
            resumedSession = true
          } else {
            runtime.knownSessions.delete(parsed.sessionId)
          }
        }
      }

      if (!sessionResult) {
        sessionResult = await rpc.request('session/new', {
          cwd: workingDirectory,
          mcpServers: [],
        })
      }

      const sessionId = sessionResult?.sessionId
      if (!sessionId) {
        throw new Error('OpenCode ACP returned no session id')
      }
      activeSessionId = sessionId
      runtime.lastSessionId = sessionId
      runtime.knownSessions.add(sessionId)

      const availableModes = normalizeAvailableModes(sessionResult?.modes?.availableModes)
      if (availableModes.length > 0) {
        runtime.availableModesBySessionId.set(sessionId, availableModes)
      }

      const currentModeId = typeof sessionResult?.modes?.currentModeId === 'string'
        ? sessionResult.modes.currentModeId
        : null
      if (currentModeId) {
        runtime.sessionModeById.set(sessionId, currentModeId)
      }

      if (typeof parsed.modeId === 'string' && parsed.modeId.trim().length > 0) {
        const requestedModeId = parsed.modeId.trim()
        const appliedModeId = runtime.sessionModeById.get(sessionId)
        if (appliedModeId !== requestedModeId) {
          await rpc.request('session/set_mode', {
            sessionId,
            modeId: requestedModeId,
          })
          runtime.sessionModeById.set(sessionId, requestedModeId)
        }
      }

      const cachedUsage = runtime.sessionUsageById.get(sessionId)
      if (cachedUsage) {
        latestUsage = cachedUsage
      }

      const lastUser = [...parsed.messages]
        .reverse()
        .find((message) => message.role === 'user' && message.content.trim().length > 0)
      const userCommand = parseSlashCommand(lastUser?.content)
      const promptText = resumedSession && lastUser ? lastUser.content : toTranscript(parsed.messages)

      if (userCommand?.name === 'compact') {
        emitEvent({
          type: 'tool',
          id: 'session-compact',
          status: 'in_progress',
          kind: 'session',
          title: 'Compacting...',
          detail: 'Summarizing conversation context',
        })
      }

      let promptResult
      try {
        promptResult = await rpc.request('session/prompt', {
          sessionId,
          prompt: [{ type: 'text', text: promptText }],
        })
      } catch (error) {
        if (userCommand?.name === 'compact') {
          emitEvent({
            type: 'tool',
            id: 'session-compact',
            status: 'failed',
            kind: 'session',
            title: 'Compacting...',
            detail: error instanceof Error ? error.message : 'Compaction command failed',
          })
        }
        throw error
      }

      if (userCommand?.name === 'compact') {
        emitEvent({
          type: 'tool',
          id: 'session-compact',
          status: 'completed',
          kind: 'session',
          title: 'Compacting...',
          detail: 'Conversation context updated',
        })
      }

      const promptUsage = normalizeAcpUsageSnapshot(promptResult?.usage)
      if (promptUsage) {
        latestUsage = promptUsage
        runtime.sessionUsageById.set(sessionId, promptUsage)
      }

      const content = assistantText.trim()
      if (!content && !userCommand) {
        if (aborted) {
          throw new Error('Generation cancelled')
        }
        throw new Error('OpenCode ACP returned no assistant text')
      }

      return {
        id: sessionId,
        content,
        model: parsed.model || provider.model,
        usage: latestUsage ?? promptResult?.usage ?? null,
      }
    } finally {
      if (abortSignal) {
        abortSignal.removeEventListener('abort', handleAbort)
      }
      stopListening()
    }
  })
}

async function waitForAvailableCommands(runtime, sessionId, timeoutMs = 1200) {
  const cached = runtime.availableCommandsBySessionId.get(sessionId)
  if (cached && cached.length > 0) {
    return cached
  }

  return new Promise((resolve) => {
    let settled = false
    const finish = (commands) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      stop()
      resolve(commands)
    }

    const stop = runtime.rpc.onNotification((msg) => {
      if (msg.method !== 'session/update') {
        return
      }

      if (msg?.params?.sessionId !== sessionId) {
        return
      }

      const update = msg?.params?.update
      if (update?.sessionUpdate !== 'available_commands_update') {
        return
      }

      const commands = normalizeAvailableCommands(update?.availableCommands)
      if (commands.length === 0) {
        return
      }

      runtime.availableCommands = commands
      runtime.availableCommandsBySessionId.set(sessionId, commands)
      finish(commands)
    })

    const timer = setTimeout(() => {
      finish([])
    }, timeoutMs)
  })
}

async function requestViaCopilotSdk(parsed, provider, emitEvent = () => {}) {
  try {
    return await withCopilotRuntimeRetry(async (runtime) => {
      const session = await runtime.client.createSession({
        model: parsed.model || provider.model || 'gpt-4.1',
        streaming: true,
        onPermissionRequest:
          typeof runtime.approveAll === 'function' ? runtime.approveAll : async () => ({ outcome: 'allow' }),
      })

      const unsubscribe = session.on((event) => {
        if (event?.type === 'assistant.message_delta') {
          const delta = event?.data?.deltaContent
          if (typeof delta === 'string' && delta.length > 0) {
            emitEvent({ type: 'text-delta', delta })
          }
        }
      })

      const prompt = `${toTranscript(parsed.messages)}\n\nWorking directory: ${parsed.cwd || process.cwd()}\nUse available tools to inspect and edit code when needed.`
      const response = await session.sendAndWait({ prompt })
      unsubscribe()
      const content = response?.data?.content ?? response?.content ?? ''

      if (typeof content !== 'string' || content.trim().length === 0) {
        throw new Error('Copilot SDK returned empty content')
      }

      return {
        id: null,
        content,
        model: parsed.model || provider.model || 'gpt-4.1',
        usage: null,
      }
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (isCopilotRuntimeExitError(error)) {
      copilotRuntimePromise = null
    }
    throw new Error(`Copilot SDK request failed. Ensure Copilot CLI is installed/authenticated: ${message}`)
  }
}

export async function requestAssistantReply(payload) {
  const parsed = chatRequestSchema.parse(payload)
  const provider = listProviders().find((item) => item.id === parsed.providerId)

  if (!provider) {
    throw new Error('Provider not found')
  }

  if (provider.kind !== 'acp-opencode' && provider.id !== 'opencode-acp') {
    throw new Error('Only OpenCode ACP is supported in this build.')
  }

  return requestViaOpenCodeAcp(parsed, provider)
}

export async function requestAssistantReplyStream(payload, emitEvent = () => {}, options = {}) {
  const parsed = chatRequestSchema.parse(payload)
  const provider = listProviders().find((item) => item.id === parsed.providerId)

  if (!provider) {
    throw new Error('Provider not found')
  }

  if (provider.kind !== 'acp-opencode' && provider.id !== 'opencode-acp') {
    throw new Error('Only OpenCode ACP is supported in this build.')
  }

  return requestViaOpenCodeAcp(parsed, provider, emitEvent, options)
}

async function listCodexModels(cwd) {
  if (!commandExists('codex')) {
    return []
  }

  const proc = spawnCliProcess('codex', ['app-server'], {
    cwd: cwd || process.cwd(),
  })
  const rpc = createJsonRpcConnection(proc)

  try {
    await rpc.request('initialize', {
      clientInfo: {
        name: 'opensmith',
        title: 'OpenSmith',
        version: '0.1.0',
      },
      capabilities: {
        experimentalApi: true,
      },
    })
    rpc.notify('initialized', {})

    const result = await rpc.request('model/list', { limit: 100, includeHidden: false })
    const data = Array.isArray(result?.data) ? result.data : []
    return data
      .map((item) => ({
        id: item?.model || item?.id,
        label: item?.displayName || item?.model || item?.id,
      }))
      .filter((item) => Boolean(item.id))
  } finally {
    rpc.close()
  }
}

async function listOpenCodeAcpModels(cwd) {
  const workingDirectory = cwd || process.cwd()
  try {
    return withOpenCodeRuntime(workingDirectory, async (runtime) => {
      const now = Date.now()
      if (runtime.availableModels.length > 0 && now - runtime.availableModelsFetchedAt < MODEL_CACHE_TTL_MS) {
        return runtime.availableModels
      }

      const rpc = runtime.rpc

      const sessionResult = await rpc.request('session/new', {
        cwd: workingDirectory,
        mcpServers: [],
      })

      const models = Array.isArray(sessionResult?.models?.availableModels)
        ? sessionResult.models.availableModels
        : []

      const normalized = models
        .map((item) => ({
          id: item?.modelId,
          label: item?.name || item?.modelId,
          contextWindow: resolveModelContextWindow(item),
        }))
        .filter((item) => Boolean(item.id))

      if (normalized.length > 0) {
        runtime.availableModels = normalized
        runtime.availableModelsFetchedAt = now
      }

      return normalized
    })
  } catch {
    return []
  }
}

async function listOpenCodeAcpCommands(cwd, sessionId) {
  const workingDirectory = cwd || process.cwd()
  try {
    return withOpenCodeRuntime(workingDirectory, async (runtime) => {
      const rpc = runtime.rpc

      if (!sessionId && runtime.availableCommands.length > 0) {
        return runtime.availableCommands
      }

      const preferredSessionId = sessionId || runtime.lastSessionId
      if (preferredSessionId) {
        const cached = runtime.availableCommandsBySessionId.get(preferredSessionId)
        if (cached && cached.length > 0) {
          return cached
        }

        const canResume = Boolean(runtime?.capabilities?.sessionCapabilities?.resume)
        try {
          if (canResume) {
            await rpc.request('session/resume', {
              sessionId: preferredSessionId,
              cwd: workingDirectory,
              mcpServers: [],
            })
          } else {
            await rpc.request('session/load', {
              sessionId: preferredSessionId,
              cwd: workingDirectory,
              mcpServers: [],
            })
          }
          runtime.knownSessions.add(preferredSessionId)
        } catch {
          // Ignore and continue with fresh session fallback.
        }

        const fromPreferred = await waitForAvailableCommands(runtime, preferredSessionId)
        if (fromPreferred.length > 0) {
          runtime.lastSessionId = preferredSessionId
          return fromPreferred
        }
      }

      const sessionResult = await rpc.request('session/new', {
        cwd: workingDirectory,
        mcpServers: [],
      })

      const newSessionId = sessionResult?.sessionId
      if (!newSessionId) {
        return runtime.availableCommands ?? []
      }

      runtime.knownSessions.add(newSessionId)
      runtime.lastSessionId = newSessionId

      const commands = await waitForAvailableCommands(runtime, newSessionId)
      if (commands.length > 0) {
        return commands
      }

      return runtime.availableCommands ?? []
    })
  } catch {
    return []
  }
}

async function listOpenCodeAcpModes(cwd, sessionId) {
  const workingDirectory = cwd || process.cwd()
  try {
    return withOpenCodeRuntime(workingDirectory, async (runtime) => {
      const rpc = runtime.rpc

      const readFromResult = (result) => {
        const modes = normalizeAvailableModes(result?.modes?.availableModes)
        const currentModeId = typeof result?.modes?.currentModeId === 'string'
          ? result.modes.currentModeId
          : null
        const resolvedSessionId = typeof result?.sessionId === 'string' ? result.sessionId : null

        if (resolvedSessionId && modes.length > 0) {
          runtime.availableModesBySessionId.set(resolvedSessionId, modes)
        }
        if (resolvedSessionId && currentModeId) {
          runtime.sessionModeById.set(resolvedSessionId, currentModeId)
        }

        return {
          sessionId: resolvedSessionId,
          currentModeId,
          modes,
        }
      }

      const preferredSessionId = sessionId || runtime.lastSessionId
      if (preferredSessionId) {
        const cachedModes = runtime.availableModesBySessionId.get(preferredSessionId)
        const cachedCurrent = runtime.sessionModeById.get(preferredSessionId) || null
        if (cachedModes && cachedModes.length > 0) {
          return {
            sessionId: preferredSessionId,
            currentModeId: cachedCurrent,
            modes: cachedModes,
          }
        }

        const canResume = Boolean(runtime?.capabilities?.sessionCapabilities?.resume)
        try {
          const result = canResume
            ? await rpc.request('session/resume', {
                sessionId: preferredSessionId,
                cwd: workingDirectory,
                mcpServers: [],
              })
            : await rpc.request('session/load', {
                sessionId: preferredSessionId,
                cwd: workingDirectory,
                mcpServers: [],
              })

          runtime.knownSessions.add(preferredSessionId)
          runtime.lastSessionId = preferredSessionId
          return {
            ...readFromResult(result),
            sessionId: preferredSessionId,
          }
        } catch {
          // Fall back to fresh session path.
        }
      }

      const result = await rpc.request('session/new', {
        cwd: workingDirectory,
        mcpServers: [],
      })

      const modeData = readFromResult(result)
      if (modeData.sessionId) {
        runtime.knownSessions.add(modeData.sessionId)
        runtime.lastSessionId = modeData.sessionId
      }

      return modeData
    })
  } catch {
    return {
      sessionId: sessionId || null,
      currentModeId: null,
      modes: [],
    }
  }
}

async function setOpenCodeAcpMode(cwd, sessionId, modeId) {
  const workingDirectory = cwd || process.cwd()
  const requestedModeId = typeof modeId === 'string' ? modeId.trim() : ''
  if (!requestedModeId) {
    throw new Error('modeId is required')
  }

  return withOpenCodeRuntime(workingDirectory, async (runtime) => {
    const rpc = runtime.rpc
    let activeSessionId = sessionId || runtime.lastSessionId || null

    if (activeSessionId) {
      const canResume = Boolean(runtime?.capabilities?.sessionCapabilities?.resume)
      try {
        await (canResume
          ? rpc.request('session/resume', {
              sessionId: activeSessionId,
              cwd: workingDirectory,
              mcpServers: [],
            })
          : rpc.request('session/load', {
              sessionId: activeSessionId,
              cwd: workingDirectory,
              mcpServers: [],
            }))
      } catch {
        activeSessionId = null
      }
    }

    if (!activeSessionId) {
      const created = await rpc.request('session/new', {
        cwd: workingDirectory,
        mcpServers: [],
      })
      activeSessionId = created?.sessionId || null
      if (!activeSessionId) {
        throw new Error('OpenCode ACP returned no session id for mode update')
      }
      runtime.knownSessions.add(activeSessionId)
      runtime.lastSessionId = activeSessionId
      const createdModes = normalizeAvailableModes(created?.modes?.availableModes)
      if (createdModes.length > 0) {
        runtime.availableModesBySessionId.set(activeSessionId, createdModes)
      }
    }

    await rpc.request('session/set_mode', {
      sessionId: activeSessionId,
      modeId: requestedModeId,
    })

    runtime.knownSessions.add(activeSessionId)
    runtime.lastSessionId = activeSessionId
    runtime.sessionModeById.set(activeSessionId, requestedModeId)

    return {
      sessionId: activeSessionId,
      modeId: requestedModeId,
    }
  })
}

async function listCopilotModels() {
  try {
    const result = await withCopilotRuntimeRetry((runtime) => runtime.client.listModels())
    const data = Array.isArray(result?.data)
      ? result.data
      : Array.isArray(result)
      ? result
      : Array.isArray(result?.models)
      ? result.models
      : []

    const mapped = data
      .map((item) => ({
        id: item?.id || item?.model || item?.name,
        label: item?.displayName || item?.name || item?.model || item?.id,
      }))
      .filter((item) => Boolean(item.id))

    return Array.from(new Map(mapped.map((item) => [item.id, item])).values())
  } catch (error) {
    if (isCopilotRuntimeExitError(error)) {
      copilotRuntimePromise = null
    }
    throw error
  }
}

async function withCopilotRuntimeRetry(task) {
  let runtime = await getCopilotRuntime()
  try {
    return await task(runtime)
  } catch (error) {
    if (!isCopilotRuntimeExitError(error)) {
      throw error
    }

    copilotRuntimePromise = null
    runtime = await getCopilotRuntime()
    return task(runtime)
  }
}

async function getCopilotRuntime() {
  if (!copilotRuntimePromise) {
    copilotRuntimePromise = (async () => {
      if (!commandExists('copilot')) {
        throw new Error('Copilot CLI was not found in PATH. Install and authenticate Copilot CLI first.')
      }

      ensureCopilotJsonRpcShim()
      let sdk
      try {
        sdk = await import('@github/copilot-sdk')
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (message.includes('@github/copilot-sdk')) {
          throw new Error('Copilot SDK is not installed. Run `bun add @github/copilot-sdk`.')
        }
        throw new Error(`Copilot SDK failed to load: ${message}`)
      }

      const client = new sdk.CopilotClient({
        logLevel: 'error',
        env: {
          ...process.env,
          NODE_NO_WARNINGS: '1',
        },
      })
      await client.start()
      return {
        client,
        approveAll: sdk.approveAll,
      }
    })().catch((error) => {
      copilotRuntimePromise = null
      throw error
    })
  }

  return copilotRuntimePromise
}

export async function listAssistantModels(payload) {
  const providerId = payload?.providerId
  const cwd = payload?.cwd

  if (!providerId) {
    throw new Error('providerId is required')
  }

  const provider = listProviders().find((item) => item.id === providerId)
  if (!provider) {
    throw new Error('Provider not found')
  }

  if (provider.kind !== 'acp-opencode' && provider.id !== 'opencode-acp') {
    throw new Error('Only OpenCode ACP is supported in this build.')
  }

  try {
    const models = await listOpenCodeAcpModels(cwd)
    if (models.length > 0) {
      return models
    }
  } catch {
    // Fall through to provider default.
  }

  return [{ id: provider.model, label: provider.model, contextWindow: null }]
}

export async function listAssistantCommands(payload) {
  const providerId = payload?.providerId
  const cwd = payload?.cwd
  const sessionId = payload?.sessionId

  if (!providerId) {
    throw new Error('providerId is required')
  }

  const provider = listProviders().find((item) => item.id === providerId)
  if (!provider) {
    throw new Error('Provider not found')
  }

  if (provider.kind !== 'acp-opencode' && provider.id !== 'opencode-acp') {
    throw new Error('Only OpenCode ACP is supported in this build.')
  }

  const commands = await listOpenCodeAcpCommands(cwd, sessionId)
  return commands
}

export async function listAssistantModes(payload) {
  const providerId = payload?.providerId
  const cwd = payload?.cwd
  const sessionId = payload?.sessionId

  if (!providerId) {
    throw new Error('providerId is required')
  }

  const provider = listProviders().find((item) => item.id === providerId)
  if (!provider) {
    throw new Error('Provider not found')
  }

  if (provider.kind !== 'acp-opencode' && provider.id !== 'opencode-acp') {
    throw new Error('Only OpenCode ACP is supported in this build.')
  }

  return listOpenCodeAcpModes(cwd, sessionId)
}

export async function setAssistantMode(payload) {
  const providerId = payload?.providerId
  const cwd = payload?.cwd
  const sessionId = payload?.sessionId
  const modeId = payload?.modeId

  if (!providerId) {
    throw new Error('providerId is required')
  }

  const provider = listProviders().find((item) => item.id === providerId)
  if (!provider) {
    throw new Error('Provider not found')
  }

  if (provider.kind !== 'acp-opencode' && provider.id !== 'opencode-acp') {
    throw new Error('Only OpenCode ACP is supported in this build.')
  }

  return setOpenCodeAcpMode(cwd, sessionId, modeId)
}
