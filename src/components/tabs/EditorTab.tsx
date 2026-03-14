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

function FileTreeItem({ node, currentFilePath, onSelect }: { node: FileNode, currentFilePath?: string | null, onSelect: (node: FileNode) => void }) {
  const [isOpen, setIsOpen] = useState(false)
  const [children, setChildren] = useState<FileNode[]>([])

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
            <FileTreeItem key={child.path} node={child} currentFilePath={currentFilePath} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  )
}

export function EditorTab({ tab, cwd, onChange }: Props) {
  const extensions = useMemo(() => [javascript({ jsx: true, typescript: true })], [])
  const [rootNodes, setRootNodes] = useState<FileNode[]>([])

  const isSidebarOpen = tab.sidebarOpen ?? true
  const fontSize = tab.fontSize ?? 14

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
  }, [cwd])

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
        <div className="w-64 shrink-0 flex flex-col bg-transparent border-r border-white/5">
          <div className="flex-1 overflow-y-auto p-2 scrollbar-hide pt-4">
            {rootNodes.map(node => (
              <FileTreeItem key={node.path} node={node} currentFilePath={tab.filePath} onSelect={handleSelectFile} />
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
    </section>
  )
}
