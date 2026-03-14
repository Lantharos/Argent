import { chatRequestSchema } from './schema.js'
import { getProviderSecret, listProviders } from '../store/providersStore.js'
import fs from 'node:fs'
import path from 'node:path'
import { exec, spawn, spawnSync } from 'node:child_process'
import { promisify } from 'node:util'
import readline from 'node:readline'

const execAsync = promisify(exec)
let copilotRuntimePromise = null

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

function isCopilotRuntimeExitError(error) {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('Client not connected') || message.includes('CLI server exited with code 0')
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

async function requestViaOpenCodeAcp(parsed, provider, emitEvent = () => {}) {
  if (!commandExists('opencode')) {
    throw new Error('OpenCode CLI was not found in PATH. Install OpenCode to use ACP.')
  }

  const workingDirectory = parsed.cwd || process.cwd()
  const proc = spawnCliProcess('opencode', ['acp', '--cwd', workingDirectory], {
    cwd: workingDirectory,
  })
  const rpc = createJsonRpcConnection(proc)
  let assistantText = ''

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

    const update = msg?.params?.update
    if (update?.sessionUpdate === 'agent_message_chunk') {
      const text = update?.content?.text
      if (typeof text === 'string') {
        assistantText += text
        emitEvent({ type: 'text-delta', delta: text })
      }
      return
    }

    if (update?.sessionUpdate === 'tool_call' || update?.sessionUpdate === 'tool_call_update') {
      emitEvent({
        type: 'tool',
        id: update?.toolCallId || null,
        status: update?.status || 'in_progress',
        kind: update?.kind || 'other',
        title: pickToolTitle(update),
        detail: pickToolDetail(update),
      })
    }
  })

  try {
    await rpc.request('initialize', {
      protocolVersion: 1,
      clientCapabilities: {
        _meta: {
          'terminal-auth': false,
        },
      },
    })

    const sessionResult = await rpc.request('session/new', {
      cwd: workingDirectory,
      mcpServers: [],
    })

    const sessionId = sessionResult?.sessionId
    if (!sessionId) {
      throw new Error('OpenCode ACP returned no session id')
    }

    const promptResult = await rpc.request('session/prompt', {
      sessionId,
      prompt: [{ type: 'text', text: toTranscript(parsed.messages) }],
    })

    const content = assistantText.trim()
    if (!content) {
      throw new Error('OpenCode ACP returned no assistant text')
    }

    return {
      id: sessionId,
      content,
      model: parsed.model || provider.model,
      usage: promptResult?.usage ?? null,
    }
  } finally {
    stopListening()
    rpc.close()
  }
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

export async function requestAssistantReplyStream(payload, emitEvent = () => {}) {
  const parsed = chatRequestSchema.parse(payload)
  const provider = listProviders().find((item) => item.id === parsed.providerId)

  if (!provider) {
    throw new Error('Provider not found')
  }

  if (provider.kind !== 'acp-opencode' && provider.id !== 'opencode-acp') {
    throw new Error('Only OpenCode ACP is supported in this build.')
  }

  return requestViaOpenCodeAcp(parsed, provider, emitEvent)
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
  if (!commandExists('opencode')) {
    return []
  }

  const workingDirectory = cwd || process.cwd()
  const proc = spawnCliProcess('opencode', ['acp', '--cwd', workingDirectory], {
    cwd: workingDirectory,
  })
  const rpc = createJsonRpcConnection(proc)

  try {
    await rpc.request('initialize', {
      protocolVersion: 1,
      clientCapabilities: {
        _meta: {
          'terminal-auth': false,
        },
      },
    })

    const sessionResult = await rpc.request('session/new', {
      cwd: workingDirectory,
      mcpServers: [],
    })

    const models = Array.isArray(sessionResult?.models?.availableModels)
      ? sessionResult.models.availableModels
      : []

    return models
      .map((item) => ({
        id: item?.modelId,
        label: item?.name || item?.modelId,
        contextWindow:
          item?.contextWindow ||
          item?.contextWindowTokens ||
          item?.maxInputTokens ||
          null,
      }))
      .filter((item) => Boolean(item.id))
  } finally {
    rpc.close()
  }
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
