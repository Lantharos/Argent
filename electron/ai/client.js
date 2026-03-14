import { chatRequestSchema } from './schema.js'
import { getProviderSecret, listProviders } from '../store/providersStore.js'
import fs from 'node:fs'
import path from 'node:path'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import readline from 'node:readline'
import { spawn } from 'node:child_process'

const execAsync = promisify(exec)
let copilotRuntimePromise = null

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

async function requestViaCodexAppServer(parsed, provider) {
  const codexCommand = process.platform === 'win32' ? 'codex.cmd' : 'codex'
  const proc = spawn(codexCommand, ['app-server'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })

  const rl = readline.createInterface({ input: proc.stdout })
  let nextId = 1
  const pending = new Map()
  let assistantText = ''
  let activeTurnId = null

  const send = (payload) => {
    proc.stdin.write(`${JSON.stringify(payload)}\n`)
  }

  const request = (method, params = {}) => {
    const id = nextId
    nextId += 1
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      send({ method, id, params })
    })
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
        waiter.reject(new Error(msg.error.message || 'Codex app-server error'))
      } else {
        waiter.resolve(msg.result)
      }
      return
    }

    if (msg.method === 'turn/started') {
      activeTurnId = msg?.params?.turn?.id ?? activeTurnId
    }

    if (msg.method === 'item/agentMessage/delta') {
      const delta = msg?.params?.delta ?? msg?.params?.text ?? msg?.params?.data?.deltaContent
      if (typeof delta === 'string') {
        assistantText += delta
      }
    }

    if (msg.method === 'item/completed' && msg?.params?.item?.type === 'agentMessage') {
      const text = msg?.params?.item?.text
      if (typeof text === 'string' && text.length > assistantText.length) {
        assistantText = text
      }
    }
  })

  const stderrChunks = []
  proc.stderr.on('data', (chunk) => stderrChunks.push(chunk.toString()))

  try {
    await request('initialize', {
      clientInfo: {
        name: 'opensmith',
        title: 'OpenSmith',
        version: '0.1.0',
      },
      capabilities: {
        experimentalApi: true,
      },
    })
    send({ method: 'initialized', params: {} })

    const threadResult = await request('thread/start', {
      model: parsed.model || provider.model,
      cwd: parsed.cwd || process.cwd(),
      approvalPolicy: 'never',
      sandboxPolicy: {
        type: 'workspaceWrite',
        writableRoots: [parsed.cwd || process.cwd()],
        networkAccess: true,
      },
    })

    const threadId = threadResult?.thread?.id
    if (!threadId) {
      throw new Error('Codex app-server returned no thread id')
    }

    const transcript = toTranscript(parsed.messages)
    await request('turn/start', {
      threadId,
      cwd: parsed.cwd || process.cwd(),
      model: parsed.model || provider.model,
      input: [{ type: 'text', text: transcript }],
      approvalPolicy: 'never',
      sandboxPolicy: {
        type: 'workspaceWrite',
        writableRoots: [parsed.cwd || process.cwd()],
        networkAccess: true,
      },
    })

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timed out waiting for Codex turn completion')), 180000)
      rl.on('line', (line) => {
        let msg
        try {
          msg = JSON.parse(line)
        } catch {
          return
        }
        if (msg.method === 'turn/completed') {
          const doneTurnId = msg?.params?.turn?.id
          if (!activeTurnId || !doneTurnId || doneTurnId === activeTurnId) {
            clearTimeout(timeout)
            resolve(true)
          }
        }
      })
    })

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
    rl.close()
    proc.kill()
  }
}

async function requestViaCopilotSdk(parsed, provider) {
  try {
    return await withCopilotRuntimeRetry(async (runtime) => {
      const session = await runtime.client.createSession({
        model: parsed.model || provider.model || 'gpt-4.1',
        streaming: false,
        onPermissionRequest:
          typeof runtime.approveAll === 'function' ? runtime.approveAll : async () => ({ outcome: 'allow' }),
      })

      const prompt = `${toTranscript(parsed.messages)}\n\nWorking directory: ${parsed.cwd || process.cwd()}\nUse available tools to inspect and edit code when needed.`
      const response = await session.sendAndWait({ prompt })
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

  if (provider.kind === 'codex-app-server' || provider.id === 'codex-app-server') {
    return requestViaCodexAppServer(parsed, provider)
  }

  if (provider.kind === 'copilot-sdk' || provider.id === 'copilot-sdk') {
    return requestViaCopilotSdk(parsed, provider)
  }

  const apiKey = getProviderSecret(provider.id)
  if (!apiKey && !isLocalEndpoint(provider.endpoint)) {
    throw new Error('Provider API key is missing')
  }
  return requestViaOpenAICompatible(parsed, provider, apiKey)
}

async function listCodexModels(cwd) {
  const codexCommand = process.platform === 'win32' ? 'codex.cmd' : 'codex'
  const proc = spawn(codexCommand, ['app-server'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    cwd: cwd || process.cwd(),
  })

  const rl = readline.createInterface({ input: proc.stdout })
  let nextId = 1
  const pending = new Map()

  const send = (payload) => {
    proc.stdin.write(`${JSON.stringify(payload)}\n`)
  }

  const request = (method, params = {}) => {
    const id = nextId
    nextId += 1
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      send({ method, id, params })
    })
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
        waiter.reject(new Error(msg.error.message || 'Codex app-server error'))
      } else {
        waiter.resolve(msg.result)
      }
    }
  })

  try {
    await request('initialize', {
      clientInfo: {
        name: 'opensmith',
        title: 'OpenSmith',
        version: '0.1.0',
      },
      capabilities: {
        experimentalApi: true,
      },
    })
    send({ method: 'initialized', params: {} })

    const result = await request('model/list', { limit: 100, includeHidden: false })
    const data = Array.isArray(result?.data) ? result.data : []
    return data
      .map((item) => ({
        id: item?.model || item?.id,
        label: item?.displayName || item?.model || item?.id,
      }))
      .filter((item) => Boolean(item.id))
  } finally {
    rl.close()
    proc.kill()
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

  if (provider.kind === 'codex-app-server' || provider.id === 'codex-app-server') {
    try {
      const models = await listCodexModels(cwd)
      if (models.length > 0) {
        return models
      }
    } catch {
      // Fall through to provider default.
    }
    return [{ id: provider.model, label: provider.model }]
  }

  if (provider.kind === 'copilot-sdk' || provider.id === 'copilot-sdk') {
    try {
      const models = await listCopilotModels()
      if (models.length > 0) {
        return models
      }
    } catch {
      // Fall through to provider default.
    }

    const defaults = ['gpt-4.1', provider.model]
    return Array.from(new Set(defaults.filter(Boolean))).map((model) => ({ id: model, label: model }))
  }

  return [{ id: provider.model, label: provider.model }]
}
