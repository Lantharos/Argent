import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { loadState, saveState } from './store/stateStore.js'
import {
  ensureDefaultProviders,
  listProviders,
  removeProvider,
  upsertProvider,
} from './store/providersStore.js'
import { providerSchema } from './ai/schema.js'
import { listAssistantModels, requestAssistantReply, requestAssistantReplyStream } from './ai/client.js'
import { TerminalManager } from './terminal/terminalManager.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const rendererUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173'
const isDev = !app.isPackaged && Boolean(process.env.VITE_DEV_SERVER_URL)

let windowRef = null
let terminalManager = null
const activeAIStreams = new Map()

function createMainWindow() {
  const isWindows = process.platform === 'win32'
  const isMac = process.platform === 'darwin'
  const win = new BrowserWindow({
    frame: false,
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#00000000',
    titleBarStyle: 'hidden',
    titleBarOverlay: isWindows
      ? {
          color: '#00000000',
          symbolColor: '#00000000',
          height: 0,
        }
      : false,
    vibrancy: isMac ? 'under-window' : undefined,
    visualEffectState: isMac ? 'active' : undefined,
    roundedCorners: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: true,
      webSecurity: true,
      devTools: true,
    },
  })

  win.setBackgroundColor('#00000000')
  if (isWindows) {
    win.setBackgroundMaterial('acrylic')
  }

  if (isDev) {
    win.loadURL(rendererUrl)
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  return win
}

function setupWebviewHardening() {
  app.on('web-contents-created', (_, contents) => {
    contents.on('will-attach-webview', (event, webPreferences, params) => {
      delete webPreferences.preload
      webPreferences.nodeIntegration = false
      webPreferences.contextIsolation = true
      webPreferences.sandbox = true
      webPreferences.webSecurity = true
      webPreferences.allowRunningInsecureContent = false

      try {
        const parsed = new URL(params.src)
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          event.preventDefault()
        }
      } catch {
        event.preventDefault()
      }
    })

    contents.setWindowOpenHandler(({ url }) => {
      try {
        const parsed = new URL(url)
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
          return { action: 'allow' }
        }
      } catch {
        return { action: 'deny' }
      }
      return { action: 'deny' }
    })
  })
}

function setupIpc() {
  ipcMain.handle('app:load-state', () => loadState())
  ipcMain.handle('app:save-state', (_, state) => saveState(state))

  ipcMain.handle('window:minimize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && !win.isDestroyed()) {
      win.minimize()
    }
    return true
  })

  ipcMain.handle('window:maximize-toggle', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) {
      return false
    }
    if (win.isMaximized()) {
      win.unmaximize()
    } else {
      win.maximize()
    }
    return true
  })

  ipcMain.handle('window:close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && !win.isDestroyed()) {
      win.close()
    }
    return true
  })

  ipcMain.handle('window:set-native-controls-visible', (event, visible) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed() || process.platform !== 'win32') {
      return false
    }

    win.setTitleBarOverlay({
      color: '#00000000',
      symbolColor: visible ? '#e4e7ee' : '#00000000',
      height: visible ? 36 : 0,
    })
    return true
  })

  ipcMain.handle('app:choose-folder', async () => {
    if (!windowRef) {
      return null
    }

    const result = await dialog.showOpenDialog(windowRef, {
      properties: ['openDirectory'],
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return result.filePaths[0]
  })

  ipcMain.handle('providers:list', () => listProviders())

  ipcMain.handle('providers:upsert', (_, payload) => {
    const parsed = providerSchema.parse(payload)
    return upsertProvider(parsed)
  })

  ipcMain.handle('providers:remove', (_, providerId) => removeProvider(providerId))

  ipcMain.handle('ai:send-message', async (_, payload) => requestAssistantReply(payload))
  ipcMain.handle('ai:stream-start', async (event, payload) => {
    const requestId = randomUUID()
    const sender = event.sender
    const abortController = new AbortController()

    activeAIStreams.set(requestId, {
      abort: () => abortController.abort(),
    })

    const send = (streamPayload) => {
      if (!sender.isDestroyed()) {
        sender.send('ai:stream-event', streamPayload)
      }
    }

    void (async () => {
      try {
        const reply = await requestAssistantReplyStream(payload, (streamEvent) => {
          send({ requestId, event: streamEvent })
        }, { abortSignal: abortController.signal })

        send({
          requestId,
          event: {
            type: 'done',
            reply,
          },
        })
      } catch (error) {
        send({
          requestId,
          event: {
            type: 'error',
            message: error instanceof Error ? error.message : String(error),
          },
        })
      } finally {
        activeAIStreams.delete(requestId)
      }
    })()

    return { requestId }
  })
  ipcMain.handle('ai:stream-cancel', (_, payload) => {
    const stream = activeAIStreams.get(payload?.requestId)
    if (!stream) {
      return false
    }

    stream.abort()
    activeAIStreams.delete(payload.requestId)
    return true
  })
  ipcMain.handle('ai:list-models', async (_, payload) => listAssistantModels(payload))

  ipcMain.handle('terminal:create', (_, cwd) => terminalManager.createSession(cwd))

  ipcMain.handle('terminal:write', (_, payload) => terminalManager.write(payload.id, payload.data))

  ipcMain.handle('terminal:resize', (_, payload) => terminalManager.resize(payload.id, payload.cols, payload.rows))

  ipcMain.handle('terminal:kill', (_, id) => terminalManager.kill(id))

  ipcMain.handle('fs:open-file', async (_, cwd) => {
    if (!windowRef) {
      return null
    }

    const result = await dialog.showOpenDialog(windowRef, {
      defaultPath: cwd || undefined,
      properties: ['openFile'],
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return result.filePaths[0]
  })

  ipcMain.handle('fs:read-file', (_, filePath) => {
    return fs.readFileSync(filePath, 'utf8')
  })

  ipcMain.handle('fs:save-file', (_, payload) => {
    fs.writeFileSync(payload.path, payload.content, 'utf8')
    return true
  })

  ipcMain.handle('fs:delete', (_, targetPath) => {
    try {
      fs.rmSync(targetPath, { recursive: true, force: true })
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle('fs:copy', (_, src, dest) => {
    try {
      fs.cpSync(src, dest, { recursive: true })
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle('fs:move', (_, src, dest) => {
    try {
      fs.renameSync(src, dest)
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle('fs:read-dir', (_, dirPath) => {
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true })
      return entries.map(entry => ({
        name: entry.name,
        isDirectory: entry.isDirectory(),
        path: path.join(dirPath, entry.name),
      })).sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1
        if (!a.isDirectory && b.isDirectory) return 1
        return a.name.localeCompare(b.name)
      })
    } catch (e) {
      return []
    }
  })
}

app.whenReady().then(() => {
  ensureDefaultProviders()
  setupWebviewHardening()
  windowRef = createMainWindow()
  terminalManager = new TerminalManager((channel, payload) => {
    if (windowRef && !windowRef.isDestroyed()) {
      windowRef.webContents.send(channel, payload)
    }
  })
  setupIpc()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    windowRef = createMainWindow()
  }
})
