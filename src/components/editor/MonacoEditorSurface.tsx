import { useEffect, useRef } from 'react'
import type { editor as MonacoEditor } from 'monaco-editor'
import { monaco } from '../../editor/monaco'

type Props = {
  model: MonacoEditor.ITextModel | null
  fontSize: number
  readOnly?: boolean
  onSave?: () => void
}

export function MonacoEditorSurface({ model, fontSize, readOnly = false, onSave }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const onSaveRef = useRef(onSave)

  useEffect(() => {
    onSaveRef.current = onSave
  }, [onSave])

  useEffect(() => {
    if (!containerRef.current || editorRef.current) {
      return
    }

    const editor = monaco.editor.create(containerRef.current, {
      model,
      theme: 'vs-dark',
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      fontSize,
      lineNumbersMinChars: 3,
      roundedSelection: true,
      readOnly,
      tabSize: 2,
      autoIndent: 'full',
      renderWhitespace: 'selection',
      inlineSuggest: { enabled: true },
      quickSuggestions: {
        comments: false,
        strings: true,
        other: true,
      },
      snippetSuggestions: 'top',
      suggestOnTriggerCharacters: true,
      fixedOverflowWidgets: false,
      bracketPairColorization: { enabled: true },
      guides: {
        bracketPairs: false,
        highlightActiveBracketPair: false,
        indentation: true,
      },
      padding: {
        top: 14,
        bottom: 28,
      },
    })

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      onSaveRef.current?.()
    })

    editorRef.current = editor

    return () => {
      editor.dispose()
      editorRef.current = null
    }
  }, [model, fontSize, readOnly])

  useEffect(() => {
    editorRef.current?.updateOptions({ fontSize, readOnly })
  }, [fontSize, readOnly])

  useEffect(() => {
    if (!editorRef.current || !model) {
      return
    }
    if (editorRef.current.getModel() !== model) {
      editorRef.current.setModel(model)
    }
  }, [model])

  return <div ref={containerRef} className="h-full w-full" />
}
