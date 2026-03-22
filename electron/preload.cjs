const { contextBridge, ipcRenderer } = require('electron')

function getSystemInfo() {
  try {
    const os = require('node:os')
    const platform = process.platform
    const release = typeof os.release === 'function' ? os.release() : ''
    const releaseParts = String(release).split('.')
    const rawBuild = releaseParts.length > 0 ? releaseParts[releaseParts.length - 1] : ''
    const parsedBuild = platform === 'win32' ? Number.parseInt(rawBuild || '', 10) : null
    const windowsBuildNumber = Number.isFinite(parsedBuild) ? parsedBuild : null
    const isWindows10 = platform === 'win32' && (windowsBuildNumber === null || windowsBuildNumber < 22000)

    return {
      platform,
      release,
      isWindows10,
      terminalBackend: platform === 'win32' && isWindows10 ? 'winpty' : 'conpty',
      windowsBuildNumber,
    }
  } catch {
    return {
      platform: process.platform,
      release: '',
      isWindows10: false,
      terminalBackend: process.platform === 'win32' ? 'conpty' : 'conpty',
      windowsBuildNumber: null,
    }
  }
}

function on(channel, callback) {
  const handler = (_, payload) => callback(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const systemInfo = getSystemInfo()

contextBridge.exposeInMainWorld('argent', {
  system: systemInfo,
  git: {
    checkInstalled: () => ipcRenderer.invoke('git:check-installed'),
    exec: (opts) => ipcRenderer.invoke('git:exec', opts),
    clone: (opts) => ipcRenderer.invoke('git:clone', opts),
  },
  app: {
    loadState: () => ipcRenderer.invoke('app:load-state'),
    saveState: (state) => ipcRenderer.invoke('app:save-state', state),
    chooseFolder: () => ipcRenderer.invoke('app:choose-folder'),
    openInExplorer: (targetPath) => ipcRenderer.invoke('app:open-in-explorer', targetPath),
    getHomeDirectory: () => ipcRenderer.invoke('app:get-home-directory'),
    getUpdateReady: () => ipcRenderer.invoke('app:get-update-ready'),
    restartToUpdate: () => ipcRenderer.invoke('app:restart-to-update'),
    triggerTestUpdateReady: () => ipcRenderer.invoke('app:trigger-test-update-ready'),
    onOpenCommandPalette: (callback) => on('app:open-command-palette', callback),
    onUpdateReady: (callback) => on('app:update-ready', callback),
  },
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximizeToggle: () => ipcRenderer.invoke('window:maximize-toggle'),
    close: () => ipcRenderer.invoke('window:close'),
    getBounds: () => ipcRenderer.invoke('window:get-bounds'),
    setPosition: (x, y) => ipcRenderer.invoke('window:set-position', { x, y }),
    setNativeControlsVisible: (visible) => ipcRenderer.invoke('window:set-native-controls-visible', visible),
  },
  providers: {
    list: () => ipcRenderer.invoke('providers:list'),
    upsert: (payload) => ipcRenderer.invoke('providers:upsert', payload),
    remove: (providerId) => ipcRenderer.invoke('providers:remove', providerId),
  },
  ai: {
    sendMessage: (payload) => ipcRenderer.invoke('ai:send-message', payload),
    streamStart: (payload) => ipcRenderer.invoke('ai:stream-start', payload),
    streamCancel: (payload) => ipcRenderer.invoke('ai:stream-cancel', payload),
    listModels: (payload) => ipcRenderer.invoke('ai:list-models', payload),
    listCommands: (payload) => ipcRenderer.invoke('ai:list-commands', payload),
    listModes: (payload) => ipcRenderer.invoke('ai:list-modes', payload),
    setMode: (payload) => ipcRenderer.invoke('ai:set-mode', payload),
    getCliStatus: () => ipcRenderer.invoke('ai:get-cli-status'),
    installCli: (payload) => ipcRenderer.invoke('ai:install-cli', payload),
    onStreamEvent: (callback) => on('ai:stream-event', callback),
  },
  terminal: {
    create: (cwd) => ipcRenderer.invoke('terminal:create', cwd),
    write: (id, data) => ipcRenderer.invoke('terminal:write', { id, data }),
    resize: (id, cols, rows) => ipcRenderer.invoke('terminal:resize', { id, cols, rows }),
    kill: (id) => ipcRenderer.invoke('terminal:kill', id),
    onData: (callback) => on('terminal:data', callback),
    onExit: (callback) => on('terminal:exit', callback),
  },
  editor: {
    detectWorkspace: (workspacePath) => ipcRenderer.invoke('editor:detect-workspace', { workspacePath }),
    getServerStatus: (payload) => ipcRenderer.invoke('editor:get-server-status', payload),
    installServer: (payload) => ipcRenderer.invoke('editor:install-server', payload),
    startServer: (payload) => ipcRenderer.invoke('editor:start-server', payload),
    openDocument: (payload) => ipcRenderer.invoke('editor:open-document', payload),
    changeDocument: (payload) => ipcRenderer.invoke('editor:change-document', payload),
    closeDocument: (payload) => ipcRenderer.invoke('editor:close-document', payload),
    requestCompletion: (payload) => ipcRenderer.invoke('editor:request-completion', payload),
    requestHover: (payload) => ipcRenderer.invoke('editor:request-hover', payload),
    requestDefinition: (payload) => ipcRenderer.invoke('editor:request-definition', payload),
    requestRename: (payload) => ipcRenderer.invoke('editor:request-rename', payload),
    requestFormatting: (payload) => ipcRenderer.invoke('editor:request-formatting', payload),
    requestCodeActions: (payload) => ipcRenderer.invoke('editor:request-code-actions', payload),
    launchGodotEditor: (workspacePath) => ipcRenderer.invoke('editor:launch-godot-editor', { workspacePath }),
    runGodotProject: (workspacePath) => ipcRenderer.invoke('editor:run-godot-project', { workspacePath }),
    onEvent: (callback) => on('editor:event', callback),
  },
  fs: {
    openFile: (cwd) => ipcRenderer.invoke('fs:open-file', cwd),
    readFile: (path) => ipcRenderer.invoke('fs:read-file', path),
    readFileBase64: (path) => ipcRenderer.invoke('fs:read-file-base64', path),
    saveFile: (path, content) => ipcRenderer.invoke('fs:save-file', { path, content }),
    createFile: (path) => ipcRenderer.invoke('fs:create-file', path),
    createDir: (path) => ipcRenderer.invoke('fs:create-dir', path),
    readDir: (dirPath) => ipcRenderer.invoke('fs:read-dir', dirPath),
    delete: (path) => ipcRenderer.invoke('fs:delete', path),
    copy: (src, dest) => ipcRenderer.invoke('fs:copy', src, dest),
    move: (src, dest) => ipcRenderer.invoke('fs:move', src, dest),
  },
})
