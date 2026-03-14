import { useMemo } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { javascript } from '@codemirror/lang-javascript'
import { oneDark } from '@codemirror/theme-one-dark'
import type { EditorTabData } from '../../types/opensmith'

type Props = {
  tab: EditorTabData
  cwd: string
  onChange: (next: EditorTabData) => void
}

export function EditorTab({ tab, cwd, onChange }: Props) {
  const extensions = useMemo(() => [javascript({ jsx: true, typescript: true })], [])

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
    <section className="tab-pane editor-tab">
      <header className="pane-head">
        <button className="chip-btn" onClick={openFile}>
          Open File
        </button>
        <button className="chip-btn" onClick={saveFile} disabled={!tab.filePath || !tab.dirty}>
          Save
        </button>
        <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[#818181] text-xs font-mono">{tab.filePath ?? 'No file selected'}</span>
      </header>

      <div className="editor-frame glass-panel">
        <CodeMirror
          value={tab.content}
          height="100%"
          theme={oneDark}
          extensions={extensions}
          onChange={(value) => onChange({ ...tab, content: value, dirty: true })}
        />
      </div>
    </section>
  )
}
