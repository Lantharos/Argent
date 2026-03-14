import { useState, useEffect, useMemo } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { javascript } from '@codemirror/lang-javascript'
import { oneDark } from '@codemirror/theme-one-dark'
import { ChevronRight, ChevronDown, File, Folder, FolderOpen, PanelLeft } from 'lucide-react'
import type { EditorTabData } from '../../types/opensmith'

type Props = {
  tab: EditorTabData
  cwd: string
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
  onContextMenu: (e: React.MouseEvent, node: FileNode) => void
  refreshCount: number
}

function FileTreeItem({ node, currentFilePath, onSelect, onContextMenu, refreshCount }: FileTreeItemProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [children, setChildren] = useState<FileNode[]>([])

  useEffect(() => {
    if (isOpen && node.isDirectory) {
      window.opensmith.fs.readDir(node.path).then(setChildren)
    }
  }, [isOpen, refreshCount, node.path])

  const toggle = async () => {
    if (node.isDirectory) {
      if (!isOpen && children.length === 0) {
        const kids = await window.opensmith.fs.readDir(node.path)
        setChildren(kids)
      }
      setIsOpen(!isOpen)
    } else {
      onSelect(node)
    }
  }

  const isSelected = currentFilePath === node.path
  const isIgnored = node.name.startsWith('.') || node.name === 'node_modules' || node.name === 'dist' || node.name.endsWith('.lock')

  return (
    <div className="select-none">
      <div 
        onClick={toggle}
        onContextMenu={(e) => {
          e.stopPropagation()
          e.preventDefault()
          onContextMenu(e, node)
        }}
        className={`flex items-center gap-1.5 py-1 px-2 rounded cursor-pointer text-sm mb-0.5 transition-colors ${
          isSelected 
            ? 'bg-white/10 text-white' 
            : isIgnored 
              ? 'text-[#555] hover:bg-white/5 hover:text-[#777]'
              : 'text-[#a3a3a3] hover:bg-white/5 hover:text-[#d4d4d4]'
        }`}
      >
        <span className={`w-4 flex justify-center opacity-60 ${isIgnored ? 'text-[#444]' : 'text-[#888]'}`}>
          {node.isDirectory ? (
            isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />
          ) : null}
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
      {isOpen && node.isDirectory && children.length > 0 && (
        <div className="pl-3 ml-[7px] border-l border-white/5 mt-0.5">
          {children.map(child => (
            <FileTreeItem key={child.path} node={child} currentFilePath={currentFilePath} onSelect={onSelect} onContextMenu={onContextMenu} refreshCount={refreshCount} />
          ))}
        </div>
      )}
    </div>
  )
}

export function EditorTab({ tab, cwd, onChange }: Props) {
  const extensions = useMemo(() => [javascript({ jsx: true, typescript: true })], [])
  const [rootNodes, setRootNodes] = useState<FileNode[]>([])
  const [refreshCount, setRefreshCount] = useState(0)
  
  const [menu, setMenu] = useState<{ x: number, y: number, node: FileNode | null } | null>(null)
  const [clipboard, setClipboard] = useState<{ path: string, type: 'copy' } | null>(null)

  const isSidebarOpen = tab.sidebarOpen ?? true
  const fontSize = tab.fontSize ?? 14

  useEffect(() => {
    function handleClick() {
      setMenu(null)
    }
    window.addEventListener('click', handleClick)
    return () => window.removeEventListener('click', handleClick)
  }, [])

  function handleContextMenu(e: React.MouseEvent, node: FileNode) {
    setMenu({ x: e.clientX, y: e.clientY, node })
  }

  async function handleCopy(node: FileNode) {
    setClipboard({ path: node.path, type: 'copy' })
    setMenu(null)
  }

  async function handleDelete(node: FileNode) {
    await window.opensmith.fs.delete(node.path)
    setRefreshCount(c => c + 1)
    setMenu(null)
  }

  async function handlePaste(targetNode: FileNode | null) {
    if (!clipboard) return
    const destDir = targetNode?.isDirectory ? targetNode.path : (targetNode?.path.split(/[/\\]/).slice(0, -1).join('/') || cwd)
    const fileName = clipboard.path.split(/[/\\]/).pop()!
    const dest = `${destDir}/${fileName}`
    await window.opensmith.fs.copy(clipboard.path, dest)
    setRefreshCount(c => c + 1)
    setMenu(null)
  }

  function setSidebarOpen(open: boolean) {
    onChange({ ...tab, sidebarOpen: open })
  }

  function setFontSize(updater: ((prev: number) => number) | number) {
    const nextSize = typeof updater === 'function' ? updater(fontSize) : updater
    onChange({ ...tab, fontSize: nextSize })
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.ctrlKey || e.metaKey) {
      if (e.key === '=' || e.key === '+') {
        e.preventDefault()
        setFontSize(Math.min(fontSize + 2, 40))
      } else if (e.key === '-') {
        e.preventDefault()
        setFontSize(Math.max(fontSize - 2, 8))
      } else if (e.key === '0') {
        e.preventDefault()
        setFontSize(14)
      }
    }
  }

  useEffect(() => {
    window.opensmith.fs.readDir(cwd).then(nodes => {
      setRootNodes(nodes)
    })
  }, [cwd, refreshCount])

  async function handleSelectFile(node: FileNode) {
    if (node.isDirectory) return
    const content = await window.opensmith.fs.readFile(node.path)
    onChange({
      ...tab,
      filePath: node.path,
      title: node.name,
      content,
      dirty: false,
    })
  }

  async function openFile() {
    const filePath = await window.opensmith.fs.openFile(cwd)
    if (!filePath) {
      return
    }

    const content = await window.opensmith.fs.readFile(filePath)
    onChange({
      ...tab,
      filePath,
      title: filePath.split(/[/\\]/).at(-1) ?? 'Editor',
      content,
      dirty: false,
    })
  }

  async function saveFile() {
    if (!tab.filePath) {
      return
    }
    await window.opensmith.fs.saveFile(tab.filePath, tab.content)
    onChange({ ...tab, dirty: false })
  }

  return (
    <section 
      className="tab-pane editor-tab !flex-row !p-0 !bg-transparent h-full w-full overflow-hidden focus:outline-none"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      {/* Sidebar */}
      {isSidebarOpen && (
        <div 
          className="w-64 shrink-0 flex flex-col bg-transparent border-r border-white/5 relative"
          onContextMenu={(e) => {
            if (e.target === e.currentTarget) {
              handleContextMenu(e, { name: '', path: cwd, isDirectory: true })
            }
          }}
        >
          <div className="flex-1 overflow-y-auto p-2 scrollbar-hide pt-4">
            {rootNodes.map(node => (
              <FileTreeItem key={node.path} node={node} currentFilePath={tab.filePath} onSelect={handleSelectFile} onContextMenu={handleContextMenu} refreshCount={refreshCount} />
            ))}
          </div>
        </div>
      )}

      {/* Editor */}
      <div className="flex-1 flex flex-col min-w-0 bg-transparent">
        <header className="h-[36px] shrink-0 flex items-center px-3 gap-2 border-b border-white/5 bg-transparent">
          <button 
            className={`h-[22px] w-[22px] flex items-center justify-center rounded transition-colors border-none cursor-pointer ${
              isSidebarOpen ? 'bg-white/10 text-white' : 'hover:bg-white/5 text-[#888] hover:text-[#d4d4d4]'
            }`}
            onClick={() => setSidebarOpen(!isSidebarOpen)}
            title="Toggle Sidebar"
          >
            <PanelLeft size={13} />
          </button>
          
          <div className="w-[1px] h-3 bg-white/10 mx-1"></div>

          <button className="h-[22px] px-2.5 text-[11px] font-medium rounded hover:bg-white/5 text-[#a3a3a3] hover:text-[#d4d4d4] transition-colors border-none cursor-pointer" onClick={openFile}>
            Open
          </button>
          <button className="h-[22px] px-2.5 text-[11px] font-medium rounded hover:bg-white/5 text-[#a3a3a3] hover:text-[#d4d4d4] transition-colors border-none cursor-pointer disabled:opacity-30 disabled:hover:bg-transparent" onClick={saveFile} disabled={!tab.filePath || !tab.dirty}>
            Save
          </button>
          <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[#666] text-[11px] font-mono ml-auto mr-1">
            {tab.filePath ?? 'No file selected'}
          </span>
        </header>

        <div 
          className="flex-1 overflow-hidden relative"
          style={{ fontSize: `${fontSize}px` }}
        >
          <div className="absolute inset-0 [&_.cm-editor]:!bg-transparent [&_.cm-scroller]:!bg-transparent [&_.cm-gutters]:!bg-transparent [&_.cm-gutters]:!border-r-white/5 [&_.cm-editor.cm-focused]:outline-none [&_.cm-scroller]:scrollbar-hide h-full w-full">
            <CodeMirror
              value={tab.content}
              height="100%"
              theme={oneDark}
              className="h-full"
              extensions={extensions}
              onChange={(value) => onChange({ ...tab, content: value, dirty: true })}
            />
          </div>
        </div>
      </div>

      {menu && (
        <div 
          className="fixed z-50 bg-[#181825] border border-white/10 rounded-md shadow-2xl py-1 w-48 text-[12px] text-[#cdd6f4]"
          style={{ left: menu.x, top: menu.y }}
        >
          <button 
            className="w-full text-left px-3 py-1.5 hover:bg-white/10 transition-colors" 
            onClick={(e) => { e.stopPropagation(); handleCopy(menu.node!) }}
          >
            Copy
          </button>
          <button 
            className={`w-full text-left px-3 py-1.5 transition-colors ${clipboard ? 'hover:bg-white/10' : 'text-white/30 cursor-not-allowed'}`} 
            onClick={(e) => { e.stopPropagation(); handlePaste(menu.node) }}
            disabled={!clipboard}
          >
            Paste
          </button>
          <div className="h-[1px] bg-white/5 my-1"></div>
          <button 
            className="w-full text-left px-3 py-1.5 hover:bg-red-500/20 text-red-400 transition-colors" 
            onClick={(e) => { e.stopPropagation(); handleDelete(menu.node!) }}
          >
            Delete
          </button>
        </div>
      )}
    </section>
  )
}
