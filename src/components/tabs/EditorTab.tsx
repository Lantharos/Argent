import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { IDisposable, editor as MonacoEditor } from 'monaco-editor'
import { ChevronDown, ChevronRight, Download, File, Folder, FolderOpen, PanelLeft, Play, Puzzle, RotateCw } from 'lucide-react'
import { MonacoEditorSurface } from '../editor/MonacoEditorSurface'
import { detectLanguageFromPath, getLanguageConfig, getLanguageLabel } from '../../editor/languageRegistry'
import { lspBridge } from '../../editor/lspBridge'
import { ensureEditorModel, releaseEditorModel } from '../../editor/modelManager'
import type { EditorTabData } from '../../types/argent'
import type { LspServerState, WorkspaceFeatureInfo } from '../../editor/types'

type Props = {
  tab: EditorTabData
  cwd: string
  isActive?: boolean
  onOpenInNewTab?: (payload: { filePath: string; title: string; content: string; language: string }) => void
  onChange: (next: EditorTabData) => void
}

type FileNode = {
  name: string
  isDirectory: boolean
  path: string
}

type FileTreeItemProps = {
  node: FileNode
  currentFilePath?: string | null
  onSelect: (node: FileNode) => void
  onSelectInNewTab: (node: FileNode) => void
  onContextMenu: (e: React.MouseEvent, node: FileNode, rect?: DOMRect) => void
  onDropNode: (sourcePath: string, destNode: FileNode) => Promise<void>
  clipboard: { path: string, type: 'copy' | 'cut' } | null
  refreshCount: number
}

function FileTreeItem({ node, currentFilePath, onSelect, onSelectInNewTab, onContextMenu, onDropNode, clipboard, refreshCount }: FileTreeItemProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [children, setChildren] = useState<FileNode[]>([])

  useEffect(() => {
    if (isOpen && node.isDirectory) {
      window.argent.fs.readDir(node.path).then(setChildren)
    }
  }, [children.length, isOpen, node.isDirectory, node.path, refreshCount])

  const toggle = async (event: React.MouseEvent<HTMLDivElement>) => {
    if (node.isDirectory) {
      if (!isOpen && children.length === 0) {
        const kids = await window.argent.fs.readDir(node.path)
        setChildren(kids)
      }
      setIsOpen(!isOpen)
      return
    }

    if (event.ctrlKey || event.metaKey) {
      onSelectInNewTab(node)
      return
    }

    onSelect(node)
  }

  const isSelected = currentFilePath === node.path
  const isIgnored = node.name.startsWith('.') || node.name === 'node_modules' || node.name === 'dist' || node.name.endsWith('.lock')
  const isCut = clipboard?.type === 'cut' && clipboard.path === node.path

  return (
    <div className="select-none">
      <div
        draggable
        onMouseDown={(event) => {
          if (event.button === 1 && !node.isDirectory) {
            event.preventDefault()
            event.stopPropagation()
            onSelectInNewTab(node)
          }
        }}
        onAuxClick={(event) => {
          if (event.button === 1 && !node.isDirectory) {
            event.preventDefault()
            event.stopPropagation()
          }
        }}
        onDragStart={(event) => {
          event.dataTransfer.setData('text/plain', node.path)
        }}
        onDragOver={(event) => {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
        }}
        onDrop={(event) => {
          event.preventDefault()
          event.stopPropagation()
          const source = event.dataTransfer.getData('text/plain')
          if (source && source !== node.path) {
            void onDropNode(source, node)
          }
        }}
        onClick={toggle}
        onContextMenu={(event) => {
          event.stopPropagation()
          event.preventDefault()
          onContextMenu(event, node, event.currentTarget.getBoundingClientRect())
        }}
        className={`mb-0.5 flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-0.5 text-sm transition-colors ${
          isSelected
            ? 'bg-white/10 text-white'
            : isIgnored
              ? 'text-[#555] hover:bg-white/5 hover:text-[#777]'
              : 'text-[#a3a3a3] hover:bg-white/5 hover:text-[#d4d4d4]'
        } ${isCut ? 'opacity-40' : ''}`}
      >
        <span className={`flex w-4 justify-center opacity-60 ${isIgnored ? 'text-[#444]' : 'text-[#888]'}`}>
          {node.isDirectory ? (isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : null}
        </span>
        <span className={`flex justify-center ${isIgnored ? 'text-[#555]' : 'text-[#888]'}`}>
          {node.isDirectory ? (
            isOpen ? <FolderOpen size={14} /> : <Folder size={14} />
          ) : (
            <File size={13} className={isIgnored ? 'text-[#555]' : 'text-[#888]'} />
          )}
        </span>
        <span className="truncate">{node.name}</span>
      </div>
      {isOpen && node.isDirectory && children.length > 0 ? (
        <div className="ml-[10px] mt-0.5 border-l border-white/5 pl-[10px]">
          {children.map((child) => (
            <FileTreeItem
              key={child.path}
              node={child}
              currentFilePath={currentFilePath}
              onSelect={onSelect}
              onSelectInNewTab={onSelectInNewTab}
              onContextMenu={onContextMenu}
              onDropNode={onDropNode}
              clipboard={clipboard}
              refreshCount={refreshCount}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function getStatusText(languageId: string, status: LspServerState | null) {
  const config = getLanguageConfig(languageId)
  if (config.support === 'monaco') {
    return 'Monaco IntelliSense'
  }
  if (config.support === 'basic') {
    return 'Syntax support'
  }
  if (!status) {
    return 'Waiting for language server'
  }
  return status.detail ? `${status.status}: ${status.detail}` : status.status
}

export function EditorTab({ tab, cwd, isActive = true, onOpenInNewTab, onChange }: Props) {
  const [rootNodes, setRootNodes] = useState<FileNode[]>([])
  const [refreshCount, setRefreshCount] = useState(0)
  const [model, setModel] = useState<MonacoEditor.ITextModel | null>(null)
  const [workspaceInfo, setWorkspaceInfo] = useState<WorkspaceFeatureInfo | null>(null)
  const [serverStatus, setServerStatus] = useState<LspServerState | null>(null)
  const [externalChangeNotice, setExternalChangeNotice] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number, y: number, node: FileNode | null } | null>(null)
  const [clipboard, setClipboard] = useState<{ path: string, type: 'copy' | 'cut' } | null>(null)
  const sidebarRef = useRef<HTMLDivElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const versionRef = useRef(1)
  const suppressModelChangeRef = useRef(false)
  const currentFileRef = useRef<string | null>(tab.filePath)
  const tabRef = useRef(tab)
  const onChangeRef = useRef(onChange)
  const changeDisposableRef = useRef<IDisposable | null>(null)
  const [installingServer, setInstallingServer] = useState(false)
  const [installMessage, setInstallMessage] = useState<string | null>(null)
  const [startingServer, setStartingServer] = useState(false)

  const isSidebarOpen = tab.sidebarOpen ?? true
  const fontSize = tab.fontSize ?? 14
  const languageId = useMemo(() => {
    if (tab.filePath) {
      return detectLanguageFromPath(tab.filePath).id
    }
    return tab.language || 'plaintext'
  }, [tab.filePath, tab.language])
  const languageLabel = useMemo(() => getLanguageLabel(languageId), [languageId])
  const languageConfig = useMemo(() => getLanguageConfig(languageId), [languageId])

  useEffect(() => {
    currentFileRef.current = tab.filePath
    tabRef.current = tab
    onChangeRef.current = onChange
  }, [onChange, tab])

  useEffect(() => {
    if (!installMessage) {
      return
    }

    const timeout = window.setTimeout(() => {
      setInstallMessage(null)
    }, 5000)

    return () => window.clearTimeout(timeout)
  }, [installMessage])

  useEffect(() => {
    if (!externalChangeNotice || externalChangeNotice === 'File changed outside the editor. Save or reopen to reconcile.') {
      return
    }

    const timeout = window.setTimeout(() => {
      setExternalChangeNotice(null)
    }, 5000)

    return () => window.clearTimeout(timeout)
  }, [externalChangeNotice])

  useEffect(() => {
    window.argent.fs.readDir(cwd).then(setRootNodes)
  }, [cwd, refreshCount])

  useEffect(() => {
    window.argent.editor.detectWorkspace(cwd).then(setWorkspaceInfo)
  }, [cwd])

  useEffect(() => {
    function closeWhenOutside(event: MouseEvent) {
      const target = event.target as Node | null
      if (menuRef.current && target && menuRef.current.contains(target)) {
        return
      }
      setMenu(null)
    }

    function closeFromUiInteraction() {
      setMenu(null)
    }

    const unsubscribe = lspBridge.subscribe((event) => {
      if (event.type === 'status' && event.filePath && event.filePath === currentFileRef.current) {
        setServerStatus(event.server)
      }

      if (event.type === 'diagnostics' && event.filePath === currentFileRef.current) {
        setServerStatus(event.server)
      }

      if (event.type === 'file-changed' && event.filePath === currentFileRef.current && tabRef.current.filePath) {
        if (tabRef.current.dirty) {
          setExternalChangeNotice('File changed outside the editor. Save or reopen to reconcile.')
          return
        }

        void window.argent.fs.readFile(tabRef.current.filePath).then((content) => {
          suppressModelChangeRef.current = true
          setExternalChangeNotice('Reloaded external file change.')
          versionRef.current += 1
          onChangeRef.current({
            ...tabRef.current,
            content,
            dirty: false,
            language: detectLanguageFromPath(tabRef.current.filePath).id,
          })
        })
      }
    })

    document.addEventListener('mousedown', closeWhenOutside, true)
    document.addEventListener('contextmenu', closeWhenOutside, true)
    window.addEventListener('argent:ui-interaction', closeFromUiInteraction)

    return () => {
      unsubscribe()
      document.removeEventListener('mousedown', closeWhenOutside, true)
      document.removeEventListener('contextmenu', closeWhenOutside, true)
      window.removeEventListener('argent:ui-interaction', closeFromUiInteraction)
    }
  }, [])

  useEffect(() => {
    if (!tab.filePath) {
      changeDisposableRef.current?.dispose()
      changeDisposableRef.current = null
      return
    }

    let disposed = false
    const filePath = tab.filePath
    const initialContent = tabRef.current.content
    versionRef.current = 1
    lspBridge.ensureLanguageProviders(languageId)
    lspBridge.setDocumentContext(filePath, {
      workspacePath: cwd,
      languageId: languageConfig.lspLanguageId ?? languageId,
    })

    void window.argent.editor.getServerStatus({
      workspacePath: cwd,
      languageId: languageConfig.lspLanguageId ?? languageId,
    }).then((status) => {
      if (!disposed) {
        setServerStatus(status)
      }
    })

    void ensureEditorModel(filePath, languageId, initialContent).then((nextModel) => {
      if (disposed) {
        return
      }

      suppressModelChangeRef.current = false
      setModel(nextModel)

      changeDisposableRef.current?.dispose()
      changeDisposableRef.current = nextModel.onDidChangeContent(() => {
        if (suppressModelChangeRef.current) {
          suppressModelChangeRef.current = false
          return
        }

        const content = nextModel.getValue()
        versionRef.current += 1
        onChangeRef.current({
          ...tabRef.current,
          content,
          dirty: true,
          language: languageId,
        })

        if (languageConfig.support === 'lsp') {
          void window.argent.editor.changeDocument({
            workspacePath: cwd,
            filePath,
            languageId: languageConfig.lspLanguageId ?? languageId,
            content,
            version: versionRef.current,
          })
        }
      })

      if (languageConfig.support === 'lsp') {
        void window.argent.editor.openDocument({
          workspacePath: cwd,
          filePath,
          languageId: languageConfig.lspLanguageId ?? languageId,
          content: nextModel.getValue(),
          version: versionRef.current,
        })
      }
    })

    return () => {
      disposed = true
      changeDisposableRef.current?.dispose()
      changeDisposableRef.current = null
      if (languageConfig.support === 'lsp') {
        void window.argent.editor.closeDocument({
          workspacePath: cwd,
          filePath,
          languageId: languageConfig.lspLanguageId ?? languageId,
        })
      }
      lspBridge.clearDocumentContext(filePath)
      releaseEditorModel(filePath)
    }
  }, [cwd, languageConfig.lspLanguageId, languageConfig.support, languageId, tab.filePath])

  useEffect(() => {
    if (!model || model.getValue() === tab.content) {
      return
    }
    suppressModelChangeRef.current = true
    model.setValue(tab.content)
  }, [model, tab.content])

  function closeMenuIfOutside(target: EventTarget | null) {
    const node = target as Node | null
    if (menuRef.current && node && menuRef.current.contains(node)) {
      return
    }
    setMenu(null)
  }

  function handleContextMenu(event: React.MouseEvent, node: FileNode, rect?: DOMRect) {
    const menuWidth = 192
    const menuHeight = 160
    const menuGap = 4
    const sidebarRect = sidebarRef.current?.getBoundingClientRect()

    let x = event.clientX
    let y = event.clientY

    if (sidebarRect) {
      x = event.clientX - sidebarRect.left
      y = event.clientY - sidebarRect.top

      if (rect) {
        y = rect.bottom - sidebarRect.top + menuGap
      }

      if (x + menuWidth > sidebarRect.width) {
        x = sidebarRect.width - menuWidth - 6
      }
      if (y + menuHeight > sidebarRect.height) {
        y = sidebarRect.height - menuHeight - 6
      }

      x = Math.max(6, x)
      y = Math.max(6, y)
    }

    setMenu({ x, y, node })
  }

  async function handleSelectFile(node: FileNode) {
    if (node.isDirectory) {
      return
    }

    const content = await window.argent.fs.readFile(node.path)
    onChange({
      ...tab,
      filePath: node.path,
      title: node.name,
      content,
      dirty: false,
      language: detectLanguageFromPath(node.path).id,
    })
  }

  async function handleSelectFileInNewTab(node: FileNode) {
    if (node.isDirectory) {
      return
    }

    const content = await window.argent.fs.readFile(node.path)
    const title = node.name || node.path.split(/[/\\]/).at(-1) || 'Editor'
    const language = detectLanguageFromPath(node.path).id

    if (onOpenInNewTab) {
      onOpenInNewTab({
        filePath: node.path,
        title,
        content,
        language,
      })
      return
    }

    onChange({
      ...tab,
      filePath: node.path,
      title,
      content,
      dirty: false,
      language,
    })
  }

  async function openFile() {
    const filePath = await window.argent.fs.openFile(cwd)
    if (!filePath) {
      return
    }

    const content = await window.argent.fs.readFile(filePath)
    onChange({
      ...tab,
      filePath,
      title: filePath.split(/[/\\]/).at(-1) ?? 'Editor',
      content,
      dirty: false,
      language: detectLanguageFromPath(filePath).id,
    })
  }

  const saveFile = useCallback(async () => {
    if (!tab.filePath) {
      return
    }

    await window.argent.fs.saveFile(tab.filePath, tab.content)
    setExternalChangeNotice(null)
    onChangeRef.current({ ...tabRef.current, dirty: false, language: languageId })
  }, [languageId, tab.content, tab.filePath])

  const handleSave = useCallback(() => {
    void saveFile()
  }, [saveFile])

  const installSupported = Boolean(serverStatus?.install?.supported)
  const installLabel = serverStatus?.install?.label ?? 'Install LSP'
  const canStartServer = languageConfig.support === 'lsp' && serverStatus?.status === 'stopped'

  async function handleInstallServer() {
    setInstallingServer(true)
    setInstallMessage(null)
    try {
      const result = await window.argent.editor.installServer({
        workspacePath: cwd,
        languageId: languageConfig.lspLanguageId ?? languageId,
      })
      setInstallMessage(result.message)
      const status = await window.argent.editor.getServerStatus({
        workspacePath: cwd,
        languageId: languageConfig.lspLanguageId ?? languageId,
      })
      setServerStatus(status)
    } catch (error) {
      setInstallMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setInstallingServer(false)
    }
  }

  async function handleStartServer() {
    setStartingServer(true)
    setInstallMessage(null)
    try {
      const result = await window.argent.editor.startServer({
        workspacePath: cwd,
        languageId: languageConfig.lspLanguageId ?? languageId,
        filePath: tab.filePath,
      })
      setInstallMessage(result.message)
      const status = await window.argent.editor.getServerStatus({
        workspacePath: cwd,
        languageId: languageConfig.lspLanguageId ?? languageId,
      })
      setServerStatus(status)
    } catch (error) {
      setInstallMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setStartingServer(false)
    }
  }

  async function handleLaunchGodotEditor() {
    setInstallMessage(null)
    try {
      await window.argent.editor.launchGodotEditor(cwd)
      setInstallMessage('Godot editor launched.')
    } catch (error) {
      setInstallMessage(error instanceof Error ? error.message : String(error))
    }
  }

  async function handleRunGodotProject() {
    setInstallMessage(null)
    try {
      await window.argent.editor.runGodotProject(cwd)
      setInstallMessage('Godot project launched.')
    } catch (error) {
      setInstallMessage(error instanceof Error ? error.message : String(error))
    }
  }

  async function handleDelete(node: FileNode) {
    await window.argent.fs.delete(node.path)
    if (clipboard?.path === node.path) {
      setClipboard(null)
    }
    setRefreshCount((count) => count + 1)
    setMenu(null)
  }

  async function handleDropNode(sourcePath: string, destNode: FileNode) {
    const destDir = destNode.isDirectory ? destNode.path : (destNode.path.split(/[/\\]/).slice(0, -1).join('/') || cwd)
    const fileName = sourcePath.split(/[/\\]/).pop() ?? ''
    const dest = `${destDir}/${fileName}`
    if (sourcePath !== dest) {
      await window.argent.fs.move(sourcePath, dest)
      setRefreshCount((count) => count + 1)
    }
  }

  async function handlePaste(targetNode: FileNode | null) {
    if (!clipboard) {
      return
    }

    const destDir = targetNode?.isDirectory ? targetNode.path : (targetNode?.path.split(/[/\\]/).slice(0, -1).join('/') || cwd)
    const fileName = clipboard.path.split(/[/\\]/).pop() ?? ''
    const dest = `${destDir}/${fileName}`
    if (clipboard.type === 'cut') {
      await window.argent.fs.move(clipboard.path, dest)
      setClipboard(null)
    } else {
      await window.argent.fs.copy(clipboard.path, dest)
    }
    setRefreshCount((count) => count + 1)
    setMenu(null)
  }

  function setSidebarOpen(open: boolean) {
    onChange({ ...tab, sidebarOpen: open, language: languageId })
  }

  function setFontSize(updater: ((prev: number) => number) | number) {
    const nextSize = typeof updater === 'function' ? updater(fontSize) : updater
    onChange({ ...tab, fontSize: nextSize, language: languageId })
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (!event.ctrlKey && !event.metaKey) {
      return
    }

    if (event.key === '=' || event.key === '+') {
      event.preventDefault()
      setFontSize(Math.min(fontSize + 2, 40))
    } else if (event.key === '-') {
      event.preventDefault()
      setFontSize(Math.max(fontSize - 2, 8))
    } else if (event.key === '0') {
      event.preventDefault()
      setFontSize(14)
    }
  }

  useEffect(() => {
    function handleWindowKeyDown(event: KeyboardEvent) {
      if (!isActive) {
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void saveFile()
      }
    }

    window.addEventListener('keydown', handleWindowKeyDown, true)
    return () => window.removeEventListener('keydown', handleWindowKeyDown, true)
  }, [isActive, saveFile])

  return (
    <section
      className="editor-tab tab-pane !flex-row !bg-transparent !p-0 focus:outline-none h-full w-full overflow-hidden"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      {isSidebarOpen ? (
        <div
          ref={sidebarRef}
          className="relative flex w-64 shrink-0 flex-col border-r border-white/5 bg-transparent"
          onMouseDownCapture={(event) => {
            closeMenuIfOutside(event.target)
          }}
          onContextMenu={(event) => {
            if (event.target === event.currentTarget) {
              handleContextMenu(event, { name: '', path: cwd, isDirectory: true })
            }
          }}
        >
          <div className="flex-1 overflow-y-auto p-1.5 pt-2 scrollbar-hide">
            {rootNodes.map((node) => (
              <FileTreeItem
                key={node.path}
                node={node}
                currentFilePath={tab.filePath}
                onSelect={handleSelectFile}
                onSelectInNewTab={handleSelectFileInNewTab}
                onContextMenu={handleContextMenu}
                onDropNode={handleDropNode}
                clipboard={clipboard}
                refreshCount={refreshCount}
              />
            ))}
          </div>

          {menu ? (
            <div
              ref={menuRef}
              className="absolute z-50 w-48 rounded-md border border-white/5 bg-[#141414]/90 py-1.5 text-[12px] text-[#a3a3a3] shadow-2xl backdrop-blur-xl"
              style={{ left: menu.x, top: menu.y }}
            >
              <button className="w-full px-3 py-1.5 text-left transition-colors hover:bg-white/10 hover:text-[#d4d4d4]" onClick={() => setClipboard({ path: menu.node!.path, type: 'cut' })}>
                Cut
              </button>
              <button className="w-full px-3 py-1.5 text-left transition-colors hover:bg-white/10 hover:text-[#d4d4d4]" onClick={() => setClipboard({ path: menu.node!.path, type: 'copy' })}>
                Copy
              </button>
              <button
                className={`w-full px-3 py-1.5 text-left transition-colors ${clipboard ? 'hover:bg-white/10 hover:text-[#d4d4d4]' : 'cursor-not-allowed text-white/20'}`}
                onClick={() => { void handlePaste(menu.node) }}
                disabled={!clipboard}
              >
                Paste
              </button>
              <div className="mx-auto my-1.5 h-[1px] w-[calc(100%-16px)] bg-white/5" />
              <button className="w-full px-3 py-1.5 text-left text-red-500 transition-colors hover:bg-red-500/20 hover:text-red-400" onClick={() => { void handleDelete(menu.node!) }}>
                Delete
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col bg-transparent">
        <header className="flex h-[36px] shrink-0 items-center gap-2 border-b border-white/5 bg-transparent px-3">
          <button
            className={`flex h-[22px] w-[22px] items-center justify-center rounded border-none transition-colors ${
              isSidebarOpen ? 'bg-white/10 text-white' : 'cursor-pointer text-[#888] hover:bg-white/5 hover:text-[#d4d4d4]'
            }`}
            onClick={() => setSidebarOpen(!isSidebarOpen)}
            title="Toggle Sidebar"
          >
            <PanelLeft size={13} />
          </button>
          <div className="mx-1 h-3 w-[1px] bg-white/10" />
          <button className="h-[22px] rounded border-none px-2.5 text-[11px] font-medium text-[#a3a3a3] transition-colors hover:bg-white/5 hover:text-[#d4d4d4]" onClick={openFile}>
            Open
          </button>
          <button className="h-[22px] rounded border-none px-2.5 text-[11px] font-medium text-[#a3a3a3] transition-colors hover:bg-white/5 hover:text-[#d4d4d4] disabled:opacity-30 disabled:hover:bg-transparent" onClick={() => { void saveFile() }} disabled={!tab.filePath || !tab.dirty}>
            Save
          </button>
          <span className="min-w-0 flex-1 truncate whitespace-nowrap text-[11px] text-[#666]">
            {languageLabel} | {getStatusText(languageId, serverStatus)}
          </span>
          {installSupported && serverStatus?.status === 'unavailable' ? (
            <button
              className="ml-2 flex h-[22px] shrink-0 items-center gap-1 rounded border border-white/10 px-2.5 text-[11px] text-[#a3a3a3] transition-colors hover:bg-white/5 hover:text-white disabled:cursor-wait disabled:opacity-50"
              onClick={() => { void handleInstallServer() }}
              disabled={installingServer}
              title={serverStatus?.install?.detail ?? serverStatus?.detail ?? undefined}
            >
              <Download size={11} />
              {installingServer ? 'Installing...' : installLabel}
            </button>
          ) : null}
          {canStartServer ? (
            <button
              className="ml-2 flex h-[22px] shrink-0 items-center gap-1 rounded border border-white/10 px-2.5 text-[11px] text-[#a3a3a3] transition-colors hover:bg-white/5 hover:text-white disabled:cursor-wait disabled:opacity-50"
              onClick={() => { void handleStartServer() }}
              disabled={startingServer}
            >
              <RotateCw size={11} />
              {startingServer ? 'Starting...' : 'Start LSP'}
            </button>
          ) : null}
          {workspaceInfo?.isGodotProject && languageId === 'gdscript' ? (
            <>
              <button
                className="ml-auto flex h-[22px] items-center gap-1 rounded border border-white/10 px-2.5 text-[11px] text-[#a3a3a3] transition-colors hover:bg-white/5 hover:text-white"
                onClick={() => { void handleLaunchGodotEditor() }}
                title={workspaceInfo.godotExecutable ?? 'Launch Godot editor'}
              >
                <Puzzle size={11} />
                Godot
              </button>
              <button
                className="flex h-[22px] items-center gap-1 rounded border border-white/10 px-2.5 text-[11px] text-[#a3a3a3] transition-colors hover:bg-white/5 hover:text-white"
                onClick={() => { void handleRunGodotProject() }}
              >
                <Play size={11} />
                Run
              </button>
            </>
          ) : (
            <span className="ml-auto mr-1 overflow-hidden text-ellipsis whitespace-nowrap text-[11px] font-mono text-[#666]">
              {tab.filePath ?? 'No file selected'}
            </span>
          )}
        </header>

        {externalChangeNotice ? (
          <div className="border-b border-amber-400/20 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
            {externalChangeNotice}
          </div>
        ) : null}
        {installMessage ? (
          <div className="border-b border-blue-400/20 bg-blue-500/10 px-3 py-2 text-[11px] text-blue-200">
            {installMessage}
          </div>
        ) : null}

        <div className="relative flex-1 overflow-hidden" style={{ fontSize: `${fontSize}px` }}>
          {tab.filePath && model ? (
            <div className="absolute inset-0 h-full w-full [&_.monaco-editor]:!bg-transparent [&_.monaco-editor-background]:!bg-transparent">
              <MonacoEditorSurface model={model} fontSize={fontSize} onSave={handleSave} />
            </div>
          ) : (
            <div className="grid h-full place-items-center text-center text-sm text-[#666]">
              <div>
                <p>Select a file from the sidebar to start editing.</p>
                <p className="mt-2 text-[12px] text-[#555]">Languages and language servers load lazily when you open a matching file.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
