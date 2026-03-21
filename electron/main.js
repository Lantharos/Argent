import { app, BrowserWindow, ipcMain, screen, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import electronUpdater from 'electron-updater'
import { loadState, saveState } from './store/stateStore.js'
import {
  ensureDefaultProviders,
  listProviders,
  removeProvider,
  upsertProvider,
} from './store/providersStore.js'
import { providerSchema } from './ai/schema.js'
import {
  getOpenCodeCliStatus,
  installOpenCodeCli,
  listAssistantCommands,
  listAssistantModels,
  listAssistantModes,
  requestAssistantReply,
  requestAssistantReplyStream,
  setAssistantMode,
} from './ai/client.js'
import { LanguageServerManager } from './editor/languageServerManager.js'
import { TerminalManager } from './terminal/terminalManager.js'
import { setupGitHandlers } from './git/gitManager.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const WINDOWS_TITLEBAR_HEIGHT = 36
const { autoUpdater } = electronUpdater

const rendererUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173'
const isDev = !app.isPackaged && Boolean(process.env.VITE_DEV_SERVER_URL)
const windowIconPath = path.join(__dirname, 'assets', 'icon.png')

let windowRef = null
let terminalManager = null
let languageServerManager = null
const activeAIStreams = new Map()
let updateReadyPayload = null
const DEFAULT_WINDOW_WIDTH = 1400
const DEFAULT_WINDOW_HEIGHT = 900
const AUTO_UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000

function emitUpdateReadyToRenderer(payload) {
  if (!windowRef || windowRef.isDestroyed()) {
    return
  }
  windowRef.webContents.send('app:update-ready', payload)
}

function getWindowsBuildNumber() {
  if (process.platform !== 'win32') {
    return null
  }

  const rawBuild = os.release().split('.').at(-1) || ''
  const parsedBuild = Number.parseInt(rawBuild, 10)
  return Number.isFinite(parsedBuild) ? parsedBuild : null
}

function isWindows10() {
  const buildNumber = getWindowsBuildNumber()
  return process.platform === 'win32' && (buildNumber === null || buildNumber < 22000)
}

function checkForUpdates() {
  return autoUpdater.checkForUpdatesAndNotify().catch(error => {
    console.error('Auto-update check failed:', error)
    return null
  })
}

function setupAutoUpdater() {
  if (!app.isPackaged) {
    return
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('error', error => {
    console.error('Auto-updater error:', error)
  })

  autoUpdater.on('update-downloaded', info => {
    updateReadyPayload = {
      version: typeof info?.version === 'string' && info.version.length > 0 ? info.version : null,
    }
    emitUpdateReadyToRenderer(updateReadyPayload)
  })

  setTimeout(() => {
    void checkForUpdates()
  }, 10_000)

  setInterval(() => {
    void checkForUpdates()
  }, AUTO_UPDATE_INTERVAL_MS)
}

function createMainWindow() {
  const isWindows = process.platform === 'win32'
  const isMac = process.platform === 'darwin'
  const useLegacyWindowsVisuals = isWindows10()
  const primaryDisplay = screen.getPrimaryDisplay()
  const { width: availableWidth, height: availableHeight } = primaryDisplay.workAreaSize
  const shouldStartMaximized =
    availableWidth <= DEFAULT_WINDOW_WIDTH || availableHeight <= DEFAULT_WINDOW_HEIGHT
  const win = new BrowserWindow({
    frame: false,
    width: DEFAULT_WINDOW_WIDTH,
    height: DEFAULT_WINDOW_HEIGHT,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: useLegacyWindowsVisuals ? '#0b0b0b' : '#00000000',
    titleBarStyle: 'hidden',
    titleBarOverlay: isWindows
      ? {
          color: '#00000000',
          symbolColor: '#00000000',
          height: WINDOWS_TITLEBAR_HEIGHT,
        }
      : false,
    vibrancy: isMac ? 'under-window' : undefined,
    visualEffectState: isMac ? 'active' : undefined,
    roundedCorners: !useLegacyWindowsVisuals,
    icon: isMac ? undefined : windowIconPath,
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

  win.setBackgroundColor(useLegacyWindowsVisuals ? '#0b0b0b' : '#00000000')
  if (isWindows && typeof win.setBackgroundMaterial === 'function') {
    win.setBackgroundMaterial(useLegacyWindowsVisuals ? 'none' : 'acrylic')
  }
  if (shouldStartMaximized) {
    win.maximize()
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
    contents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') {
        return
      }

      const key = (input.key || '').toLowerCase()
      const isOpenPaletteShortcut = (input.control || input.meta) && ['t', 'k', 'p'].includes(key)
      if (!isOpenPaletteShortcut) {
        return
      }

      const target = contents.getType() === 'webview' ? contents.hostWebContents : contents
      if (!target || target.isDestroyed()) {
        return
      }

      event.preventDefault()
      target.send('app:open-command-palette')
    })

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
  setupGitHandlers()
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

  ipcMain.handle('window:get-bounds', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) {
      return null
    }

    const bounds = win.getBounds()
    return {
      ...bounds,
      isMaximized: win.isMaximized(),
    }
  })

  ipcMain.handle('window:set-position', (event, payload) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed() || win.isMaximized()) {
      return false
    }

    const x = Number.isFinite(payload?.x) ? Math.round(payload.x) : null
    const y = Number.isFinite(payload?.y) ? Math.round(payload.y) : null
    if (x === null || y === null) {
      return false
    }

    win.setPosition(x, y)
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
      height: WINDOWS_TITLEBAR_HEIGHT,
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

  ipcMain.handle('app:open-in-explorer', async (_, targetPath) => {
    if (!targetPath) {
      return false
    }

    try {
      const error = await shell.openPath(targetPath)
      return !error
    } catch {
      return false
    }
  })

  ipcMain.handle('app:get-home-directory', () => app.getPath('home'))
  ipcMain.handle('app:get-update-ready', () => updateReadyPayload)
  ipcMain.handle('app:restart-to-update', () => {
    if (!updateReadyPayload) {
      return false
    }

    autoUpdater.quitAndInstall()
    return true
  })
  ipcMain.handle('app:trigger-test-update-ready', () => {
    updateReadyPayload = {
      version: 'test-build',
    }
    emitUpdateReadyToRenderer(updateReadyPayload)
    return updateReadyPayload
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
  ipcMain.handle('ai:list-commands', async (_, payload) => listAssistantCommands(payload))
  ipcMain.handle('ai:list-modes', async (_, payload) => listAssistantModes(payload))
  ipcMain.handle('ai:set-mode', async (_, payload) => setAssistantMode(payload))
  ipcMain.handle('ai:get-cli-status', async () => getOpenCodeCliStatus())
  ipcMain.handle('ai:install-cli', async (_, payload) => installOpenCodeCli(payload))

  ipcMain.handle('terminal:create', (_, cwd) => terminalManager.createSession(cwd))

  ipcMain.handle('terminal:write', (_, payload) => terminalManager.write(payload.id, payload.data))

  ipcMain.handle('terminal:resize', (_, payload) => terminalManager.resize(payload.id, payload.cols, payload.rows))

  ipcMain.handle('terminal:kill', (_, id) => terminalManager.kill(id))

  ipcMain.handle('editor:detect-workspace', (_, payload) => {
    return languageServerManager.detectWorkspace(payload.workspacePath)
  })
  ipcMain.handle('editor:get-server-status', (_, payload) => languageServerManager.getServerStatus(payload))
  ipcMain.handle('editor:install-server', (_, payload) => languageServerManager.installServer(payload))
  ipcMain.handle('editor:start-server', (_, payload) => languageServerManager.startServerForUser(payload))
  ipcMain.handle('editor:open-document', (_, payload) => languageServerManager.openDocument(payload))
  ipcMain.handle('editor:change-document', (_, payload) => languageServerManager.changeDocument(payload))
  ipcMain.handle('editor:close-document', (_, payload) => languageServerManager.closeDocument(payload))
  ipcMain.handle('editor:request-completion', (_, payload) => languageServerManager.requestCompletion(payload))
  ipcMain.handle('editor:request-hover', (_, payload) => languageServerManager.requestHover(payload))
  ipcMain.handle('editor:request-definition', (_, payload) => languageServerManager.requestDefinition(payload))
  ipcMain.handle('editor:request-rename', (_, payload) => languageServerManager.requestRename(payload))
  ipcMain.handle('editor:request-formatting', (_, payload) => languageServerManager.requestFormatting(payload))
  ipcMain.handle('editor:request-code-actions', (_, payload) => languageServerManager.requestCodeActions(payload))
  ipcMain.handle('editor:launch-godot-editor', (_, payload) => languageServerManager.launchGodotEditor(payload.workspacePath))
  ipcMain.handle('editor:run-godot-project', (_, payload) => languageServerManager.runGodotProject(payload.workspacePath))

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

  ipcMain.handle('fs:create-file', (_, targetPath) => {
    try {
      if (!targetPath || fs.existsSync(targetPath)) {
        return false
      }
      fs.writeFileSync(targetPath, '', { encoding: 'utf8', flag: 'wx' })
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle('fs:create-dir', (_, targetPath) => {
    try {
      if (!targetPath || fs.existsSync(targetPath)) {
        return false
      }
      fs.mkdirSync(targetPath)
      return true
    } catch {
      return false
    }
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
  setupAutoUpdater()
  terminalManager = new TerminalManager((channel, payload) => {
    if (windowRef && !windowRef.isDestroyed()) {
      windowRef.webContents.send(channel, payload)
    }
  })
  languageServerManager = new LanguageServerManager((channel, payload) => {
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
