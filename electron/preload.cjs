const { contextBridge, ipcRenderer } = require('electron')

function on(channel, callback) {
  const handler = (_, payload) => callback(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

contextBridge.exposeInMainWorld('opensmith', {
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
  },
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximizeToggle: () => ipcRenderer.invoke('window:maximize-toggle'),
    close: () => ipcRenderer.invoke('window:close'),
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
  fs: {
    openFile: (cwd) => ipcRenderer.invoke('fs:open-file', cwd),
    readFile: (path) => ipcRenderer.invoke('fs:read-file', path),
    saveFile: (path, content) => ipcRenderer.invoke('fs:save-file', { path, content }),
    readDir: (dirPath) => ipcRenderer.invoke('fs:read-dir', dirPath),
    delete: (path) => ipcRenderer.invoke('fs:delete', path),
    copy: (src, dest) => ipcRenderer.invoke('fs:copy', src, dest),
    move: (src, dest) => ipcRenderer.invoke('fs:move', src, dest),
  },
})
