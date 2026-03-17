import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { pathToFileURL, fileURLToPath } from 'node:url'
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-jsonrpc/node.js'
import {
  detectGodotExecutable,
  getInstallInfo,
  installLanguageServer,
  isLanguageServerAvailable,
  isGodotProject,
  languageServers,
  resolveCommandSpec,
  resolveExecutable,
} from './languages.js'

function toDocumentUri(filePath) {
  return pathToFileURL(path.resolve(filePath)).href
}

function toFilePath(uri) {
  return fileURLToPath(uri)
}

function normalizeStatus(languageId, status, detail = null, install = null) {
  return {
    languageId,
    status,
    detail,
    install,
  }
}

export class LanguageServerManager {
  constructor(sendToRenderer) {
    this.sendToRenderer = sendToRenderer
    this.servers = new Map()
    this.fileWatchers = new Map()
    this.pendingStarts = new Map()
  }

  createKey(workspacePath, languageId) {
    return `${workspacePath}::${languageId}`
  }

  async detectWorkspace(workspacePath) {
    const godotProject = isGodotProject(workspacePath)
    return {
      workspacePath,
      isGodotProject: godotProject,
      godotExecutable: godotProject ? await detectGodotExecutable() : null,
    }
  }

  async getServerStatus({ workspacePath, languageId }) {
    const config = languageServers[languageId]
    if (!config) {
      return normalizeStatus(languageId, 'builtin', 'This language uses Monaco support only.')
    }
    if (config.requiresGodotProject && !isGodotProject(workspacePath)) {
      return normalizeStatus(languageId, 'unavailable', 'This file is not inside a Godot project.')
    }

    const key = this.createKey(workspacePath, languageId)
    const existing = this.servers.get(key)
    if (existing) {
      return normalizeStatus(languageId, existing.status, existing.detail, await getInstallInfo(languageId, workspacePath))
    }

    const availability = await isLanguageServerAvailable(languageId, workspacePath)
    if (availability.available) {
      return normalizeStatus(
        languageId,
        'stopped',
        availability.detail ?? 'Language server installed and ready to start.',
        await getInstallInfo(languageId, workspacePath),
      )
    }

    return normalizeStatus(
      languageId,
      'unavailable',
      availability.detail ?? config.installHint ?? null,
      await getInstallInfo(languageId, workspacePath),
    )
  }

  async installServer({ workspacePath, languageId }) {
    const key = this.createKey(workspacePath, languageId)
    const existing = this.servers.get(key)
    if (existing) {
      try {
        existing.connection.dispose?.()
      } catch {}
      existing.process?.kill?.()
      existing.socket?.destroy?.()
      this.servers.delete(key)
    }

    const result = await installLanguageServer(languageId, workspacePath)
    if (!result.success) {
      return result
    }

    const config = languageServers[languageId]
    if (config && !config.requiresGodotProject) {
      const server = await this.ensureServer(workspacePath, languageId)
      if (server) {
        return {
          success: true,
          message: `${result.message} Server started.`,
        }
      }
    }

    return result
  }

  async startServerForUser({ workspacePath, languageId, filePath = null }) {
    const server = await this.ensureServer(workspacePath, languageId, filePath)
    if (!server) {
      return {
        success: false,
        message: 'Unable to start the language server.',
      }
    }
    return {
      success: true,
      message: 'Language server started.',
    }
  }

  async launchGodotEditor(workspacePath) {
    const executable = await detectGodotExecutable()
    if (!executable) {
      throw new Error('Godot executable not found in PATH. Set GODOT_EXECUTABLE or install Godot.')
    }

    const child = spawn(executable, ['--path', workspacePath, '--editor'], {
      cwd: workspacePath,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })
    child.unref()
    return true
  }

  async runGodotProject(workspacePath) {
    const executable = await detectGodotExecutable()
    if (!executable) {
      throw new Error('Godot executable not found in PATH. Set GODOT_EXECUTABLE or install Godot.')
    }

    const child = spawn(executable, ['--path', workspacePath], {
      cwd: workspacePath,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })
    child.unref()
    return true
  }

  watchFile(filePath) {
    const existing = this.fileWatchers.get(filePath)
    if (existing) {
      existing.count += 1
      return
    }

    const watcher = {
      count: 1,
      handler: (current, previous) => {
        if (current.mtimeMs === previous.mtimeMs && current.size === previous.size) {
          return
        }
        this.sendToRenderer('editor:event', {
          type: 'file-changed',
          filePath,
        })
      },
    }

    fs.watchFile(filePath, { interval: 700 }, watcher.handler)
    this.fileWatchers.set(filePath, watcher)
  }

  unwatchFile(filePath) {
    const existing = this.fileWatchers.get(filePath)
    if (!existing) {
      return
    }
    existing.count -= 1
    if (existing.count <= 0) {
      fs.unwatchFile(filePath, existing.handler)
      this.fileWatchers.delete(filePath)
    }
  }

  async emitStatus(workspacePath, languageId, status, detail = null, filePath = null) {
    this.sendToRenderer('editor:event', {
      type: 'status',
      workspacePath,
      filePath,
      languageId,
      server: normalizeStatus(languageId, status, detail, await getInstallInfo(languageId, workspacePath)),
    })
  }

  async ensureServer(workspacePath, languageId, filePath = null) {
    const config = languageServers[languageId]
    if (!config) {
      return null
    }
    if (config.requiresGodotProject && !isGodotProject(workspacePath)) {
      void this.emitStatus(workspacePath, languageId, 'unavailable', 'This file is not inside a Godot project.', filePath)
      return null
    }

    const key = this.createKey(workspacePath, languageId)
    const existing = this.servers.get(key)
    if (existing?.status === 'ready') {
      return existing
    }
    if (this.pendingStarts.has(key)) {
      return this.pendingStarts.get(key)
    }

    const starter = this.startServer(workspacePath, languageId, config, filePath).finally(() => {
      this.pendingStarts.delete(key)
    })

    this.pendingStarts.set(key, starter)
    return starter
  }

  async startServer(workspacePath, languageId, config, filePath = null) {
    void this.emitStatus(workspacePath, languageId, 'starting', 'Starting language server...', filePath)

    try {
      const transport = config.type === 'tcp'
        ? await this.createTcpTransport(config)
        : await this.createStdioTransport(workspacePath, config)

      if (!transport) {
        void this.emitStatus(workspacePath, languageId, 'unavailable', config.installHint ?? 'Language server not available.', filePath)
        return null
      }

      const connection = createMessageConnection(
        new StreamMessageReader(transport.reader),
        new StreamMessageWriter(transport.writer),
      )

      const server = {
        workspacePath,
        languageId,
        status: 'starting',
        detail: 'Initializing language server...',
        connection,
        process: transport.process ?? null,
        socket: transport.socket ?? null,
        documents: new Map(),
      }

      connection.onNotification('textDocument/publishDiagnostics', (params) => {
        const nextFilePath = toFilePath(params.uri)
        this.sendToRenderer('editor:event', {
          type: 'diagnostics',
          workspacePath,
          filePath: nextFilePath,
          languageId,
          diagnostics: params.diagnostics ?? [],
          server: normalizeStatus(languageId, 'ready', server.detail),
        })
      })

      connection.listen()

      const initializeResult = await connection.sendRequest('initialize', {
        processId: process.pid,
        rootUri: pathToFileURL(workspacePath).href,
        workspaceFolders: [
          {
            uri: pathToFileURL(workspacePath).href,
            name: path.basename(workspacePath),
          },
        ],
        capabilities: {
          textDocument: {
            synchronization: {
              didSave: true,
              willSave: false,
            },
            completion: {
              completionItem: {
                snippetSupport: true,
                documentationFormat: ['markdown', 'plaintext'],
              },
            },
            hover: {
              contentFormat: ['markdown', 'plaintext'],
            },
            definition: {
              dynamicRegistration: false,
            },
            rename: {
              dynamicRegistration: false,
            },
            formatting: {
              dynamicRegistration: false,
            },
            codeAction: {
              dynamicRegistration: false,
            },
          },
          workspace: {
            workspaceFolders: true,
          },
        },
      })

      connection.sendNotification('initialized', {})
      server.status = 'ready'
      server.detail = 'Language server connected.'
      server.capabilities = initializeResult?.capabilities ?? {}
      this.servers.set(this.createKey(workspacePath, languageId), server)
      void this.emitStatus(workspacePath, languageId, 'ready', server.detail, filePath)

      transport.onClose?.(() => {
        server.status = 'stopped'
        server.detail = 'Language server stopped.'
        void this.emitStatus(workspacePath, languageId, 'stopped', server.detail, filePath)
        this.servers.delete(this.createKey(workspacePath, languageId))
      })

      return server
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      void this.emitStatus(workspacePath, languageId, 'unavailable', detail, filePath)
      return null
    }
  }

  async createStdioTransport(workspacePath, config) {
    for (const candidate of config.commands ?? []) {
      const resolved = await resolveCommandSpec(candidate, workspacePath)
      if (!resolved) {
        continue
      }

      const child = spawn(resolved.executable, resolved.args, {
        cwd: workspacePath,
        env: process.env,
        windowsHide: true,
      })

      return {
        process: child,
        reader: child.stdout,
        writer: child.stdin,
        onClose: (callback) => {
          child.on('exit', callback)
          child.on('error', callback)
        },
      }
    }

    return null
  }

  async createTcpTransport(config) {
    return await new Promise((resolve, reject) => {
      const socket = net.createConnection({
        host: config.host,
        port: config.port,
      })

      socket.once('connect', () => {
        resolve({
          socket,
          reader: socket,
          writer: socket,
          onClose: (callback) => {
            socket.on('close', callback)
            socket.on('error', callback)
          },
        })
      })

      socket.once('error', (error) => {
        socket.destroy()
        reject(error)
      })
    })
  }

  async openDocument(payload) {
    this.watchFile(payload.filePath)
    const server = await this.ensureServer(payload.workspacePath, payload.languageId, payload.filePath)
    if (!server) {
      return null
    }

    const uri = toDocumentUri(payload.filePath)
    server.documents.set(uri, payload.version)
    server.connection.sendNotification('textDocument/didOpen', {
      textDocument: {
        uri,
        languageId: payload.languageId,
        version: payload.version,
        text: payload.content,
      },
    })

    return true
  }

  async changeDocument(payload) {
    const server = await this.ensureServer(payload.workspacePath, payload.languageId, payload.filePath)
    if (!server) {
      return null
    }

    const uri = toDocumentUri(payload.filePath)
    const wasOpen = server.documents.has(uri)
    if (!wasOpen) {
      return this.openDocument(payload)
    }

    server.documents.set(uri, payload.version)
    server.connection.sendNotification('textDocument/didChange', {
      textDocument: {
        uri,
        version: payload.version,
      },
      contentChanges: [{ text: payload.content }],
    })

    return true
  }

  async closeDocument(payload) {
    this.unwatchFile(payload.filePath)
    const key = this.createKey(payload.workspacePath, payload.languageId)
    const server = this.servers.get(key)
    if (!server) {
      return true
    }

    const uri = toDocumentUri(payload.filePath)
    if (!server.documents.has(uri)) {
      return true
    }

    server.connection.sendNotification('textDocument/didClose', {
      textDocument: { uri },
    })
    server.documents.delete(uri)
    return true
  }

  async requestCompletion(payload) {
    const server = await this.ensureServer(payload.workspacePath, payload.languageId, payload.filePath)
    if (!server) {
      return []
    }

    const response = await server.connection.sendRequest('textDocument/completion', {
      textDocument: { uri: toDocumentUri(payload.filePath) },
      position: payload.position,
    })

    return Array.isArray(response) ? response : (response?.items ?? [])
  }

  async requestHover(payload) {
    const server = await this.ensureServer(payload.workspacePath, payload.languageId, payload.filePath)
    if (!server) {
      return null
    }

    return server.connection.sendRequest('textDocument/hover', {
      textDocument: { uri: toDocumentUri(payload.filePath) },
      position: payload.position,
    })
  }

  async requestDefinition(payload) {
    const server = await this.ensureServer(payload.workspacePath, payload.languageId, payload.filePath)
    if (!server) {
      return []
    }

    const response = await server.connection.sendRequest('textDocument/definition', {
      textDocument: { uri: toDocumentUri(payload.filePath) },
      position: payload.position,
    })

    if (!response) {
      return []
    }

    return Array.isArray(response) ? response : [response]
  }

  async requestRename(payload) {
    const server = await this.ensureServer(payload.workspacePath, payload.languageId, payload.filePath)
    if (!server) {
      return null
    }

    return server.connection.sendRequest('textDocument/rename', {
      textDocument: { uri: toDocumentUri(payload.filePath) },
      position: payload.position,
      newName: payload.newName,
    })
  }

  async requestFormatting(payload) {
    const server = await this.ensureServer(payload.workspacePath, payload.languageId, payload.filePath)
    if (!server) {
      return []
    }

    return server.connection.sendRequest('textDocument/formatting', {
      textDocument: { uri: toDocumentUri(payload.filePath) },
      options: {
        insertSpaces: true,
        tabSize: 2,
      },
    })
  }

  async requestCodeActions(payload) {
    const server = await this.ensureServer(payload.workspacePath, payload.languageId, payload.filePath)
    if (!server) {
      return []
    }

    const response = await server.connection.sendRequest('textDocument/codeAction', {
      textDocument: { uri: toDocumentUri(payload.filePath) },
      range: payload.range,
      context: {
        diagnostics: payload.diagnostics,
      },
    })

    return (response ?? []).filter((entry) => entry && typeof entry.title === 'string')
  }
}
