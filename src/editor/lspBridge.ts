import type { IDisposable, editor, languages } from 'monaco-editor'
import { monaco } from './monaco'
import { getLanguageConfig } from './languageRegistry'
import type {
  EditorCodeActionRequest,
  EditorCompletionRequest,
  EditorEvent,
  EditorFormattingRequest,
  EditorHoverRequest,
  EditorRenameRequest,
  LspCodeAction,
  LspDiagnostic,
  LspHover,
  LspLocation,
  LspRange,
  LspServerState,
  LspTextEdit,
  LspWorkspaceEdit,
} from './types'

type DocumentContext = {
  workspacePath: string
  languageId: string
}

function toLspPosition(position: monaco.Position) {
  return {
    line: position.lineNumber - 1,
    character: position.column - 1,
  }
}

function toMonacoRange(range: LspRange): monaco.Range {
  return new monaco.Range(
    range.start.line + 1,
    range.start.character + 1,
    range.end.line + 1,
    range.end.character + 1,
  )
}

function markdownFromHover(contents: LspHover['contents']): string {
  if (!contents) {
    return ''
  }
  if (typeof contents === 'string') {
    return contents
  }
  if (Array.isArray(contents)) {
    return contents.map((entry) => markdownFromHover(entry)).join('\n\n')
  }
  if (typeof contents === 'object' && contents !== null) {
    const value = (contents as { value?: unknown }).value
    const kind = (contents as { kind?: unknown }).kind
    const language = (contents as { language?: unknown }).language
    if (typeof value === 'string') {
      return kind === 'markdown' ? value : `\`\`\`\n${value}\n\`\`\``
    }
    if (typeof language === 'string' && typeof value === 'string') {
      return `\`\`\`${language}\n${value}\n\`\`\``
    }
  }
  return ''
}

function toMarkerSeverity(severity?: number) {
  if (severity === 1) {
    return monaco.MarkerSeverity.Error
  }
  if (severity === 2) {
    return monaco.MarkerSeverity.Warning
  }
  if (severity === 3) {
    return monaco.MarkerSeverity.Info
  }
  return monaco.MarkerSeverity.Hint
}

function toMonacoTextEdits(edits: LspTextEdit[]): languages.TextEdit[] {
  return edits.map((edit) => ({
    range: toMonacoRange(edit.range),
    text: edit.newText,
  }))
}

function toWorkspaceEdit(edit: LspWorkspaceEdit | null | undefined): languages.WorkspaceEdit {
  const resourceEdits: languages.IWorkspaceTextEdit[] = []

  for (const [uri, edits] of Object.entries(edit?.changes ?? {})) {
    const resource = monaco.Uri.parse(uri)
    for (const textEdit of edits) {
      resourceEdits.push({
        resource,
        versionId: undefined,
        textEdit: {
          range: toMonacoRange(textEdit.range),
          text: textEdit.newText,
        },
      })
    }
  }

  return { edits: resourceEdits }
}

class LspBridge {
  private readonly subscriptions = new Set<(event: EditorEvent) => void>()
  private readonly providerDisposables = new Map<string, IDisposable[]>()
  private readonly fileStatuses = new Map<string, LspServerState>()
  private readonly documentContexts = new Map<string, DocumentContext>()
  private listening = false

  setDocumentContext(filePath: string, context: DocumentContext) {
    this.documentContexts.set(filePath, context)
  }

  clearDocumentContext(filePath: string) {
    this.documentContexts.delete(filePath)
  }

  private ensureListening() {
    if (this.listening) {
      return
    }
    this.listening = true
    window.argent.editor.onEvent((event) => {
      if (event.type === 'diagnostics') {
        this.fileStatuses.set(event.filePath, event.server)
        const model = monaco.editor.getModel(monaco.Uri.file(event.filePath))
        if (model) {
          monaco.editor.setModelMarkers(
            model,
            `lsp:${event.languageId}`,
            event.diagnostics.map((diagnostic: LspDiagnostic) => ({
              severity: toMarkerSeverity(diagnostic.severity),
              message: diagnostic.message,
              source: diagnostic.source,
              code: diagnostic.code ? String(diagnostic.code) : undefined,
              startLineNumber: diagnostic.range.start.line + 1,
              startColumn: diagnostic.range.start.character + 1,
              endLineNumber: diagnostic.range.end.line + 1,
              endColumn: diagnostic.range.end.character + 1,
            })),
          )
        }
      }

      if (event.type === 'status' && event.filePath) {
        this.fileStatuses.set(event.filePath, event.server)
      }

      for (const subscription of this.subscriptions) {
        subscription(event)
      }
    })
  }

  subscribe(callback: (event: EditorEvent) => void) {
    this.ensureListening()
    this.subscriptions.add(callback)
    return () => {
      this.subscriptions.delete(callback)
    }
  }

  getFileStatus(filePath: string | null | undefined) {
    if (!filePath) {
      return null
    }
    return this.fileStatuses.get(filePath) ?? null
  }

  ensureLanguageProviders(languageId: string) {
    this.ensureListening()
    if (this.providerDisposables.has(languageId)) {
      return
    }

    const config = getLanguageConfig(languageId)
    if (config.support !== 'lsp') {
      this.providerDisposables.set(languageId, [])
      return
    }

    const requestBase = (model: editor.ITextModel) => {
      const context = this.documentContexts.get(model.uri.fsPath)
      return {
        workspacePath: context?.workspacePath ?? '',
        filePath: model.uri.fsPath,
        languageId: context?.languageId ?? languageId,
      }
    }

    const providers: IDisposable[] = [
      monaco.languages.registerCompletionItemProvider(languageId, {
        triggerCharacters: ['.', ':', '"', "'", '/', '@'],
        provideCompletionItems: async (model, position) => {
          const payload: EditorCompletionRequest = {
            ...requestBase(model),
            position: toLspPosition(position),
          }
          const response = await window.argent.editor.requestCompletion(payload)
          return {
            suggestions: (response ?? []).map((item) => {
              const range = item.textEdit?.range
                ? toMonacoRange(item.textEdit.range)
                : new monaco.Range(
                    position.lineNumber,
                    model.getWordUntilPosition(position).startColumn,
                    position.lineNumber,
                    model.getWordUntilPosition(position).endColumn,
                  )

              return {
                label: item.label,
                kind: (item.kind as languages.CompletionItemKind | undefined) ?? monaco.languages.CompletionItemKind.Text,
                detail: item.detail,
                documentation: item.documentation,
                sortText: item.sortText,
                filterText: item.filterText,
                insertText: item.textEdit?.newText ?? item.insertText ?? item.label,
                insertTextRules: item.insertTextFormat === 2
                  ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
                  : monaco.languages.CompletionItemInsertTextRule.None,
                range,
              }
            }),
          }
        },
      }),
      monaco.languages.registerHoverProvider(languageId, {
        provideHover: async (model, position) => {
          const payload: EditorHoverRequest = {
            ...requestBase(model),
            position: toLspPosition(position),
          }
          const hover = await window.argent.editor.requestHover(payload)
          if (!hover) {
            return null
          }
          const contents = markdownFromHover(hover.contents)
          if (!contents) {
            return null
          }
          return {
            range: hover.range ? toMonacoRange(hover.range) : undefined,
            contents: [{ value: contents }],
          }
        },
      }),
      monaco.languages.registerDefinitionProvider(languageId, {
        provideDefinition: async (model, position) => {
          const payload = {
            ...requestBase(model),
            position: toLspPosition(position),
          }
          const response = await window.argent.editor.requestDefinition(payload)
          return (response ?? []).map((item: LspLocation) => ({
            uri: monaco.Uri.parse(item.uri),
            range: toMonacoRange(item.range),
          }))
        },
      }),
      monaco.languages.registerRenameProvider(languageId, {
        provideRenameEdits: async (model, position, newName) => {
          const payload: EditorRenameRequest = {
            ...requestBase(model),
            position: toLspPosition(position),
            newName,
          }
          const response = await window.argent.editor.requestRename(payload)
          return response ? toWorkspaceEdit(response) : null
        },
        resolveRenameLocation: async (model, position) => {
          const word = model.getWordAtPosition(position)
          return {
            range: word
              ? new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn)
              : new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column),
            text: word?.word ?? '',
          }
        },
      }),
      monaco.languages.registerDocumentFormattingEditProvider(languageId, {
        provideDocumentFormattingEdits: async (model) => {
          const payload: EditorFormattingRequest = requestBase(model)
          const response = await window.argent.editor.requestFormatting(payload)
          return toMonacoTextEdits(response ?? [])
        },
      }),
      monaco.languages.registerCodeActionProvider(languageId, {
        provideCodeActions: async (model, range, context) => {
          const payload: EditorCodeActionRequest = {
            ...requestBase(model),
            range: {
              start: {
                line: range.startLineNumber - 1,
                character: range.startColumn - 1,
              },
              end: {
                line: range.endLineNumber - 1,
                character: range.endColumn - 1,
              },
            },
            diagnostics: context.markers.map((marker) => ({
              message: marker.message,
              severity: marker.severity,
              source: marker.source,
              code: typeof marker.code === 'object' ? marker.code.value : marker.code,
              range: {
                start: {
                  line: marker.startLineNumber - 1,
                  character: marker.startColumn - 1,
                },
                end: {
                  line: marker.endLineNumber - 1,
                  character: marker.endColumn - 1,
                },
              },
            })),
          }
          const response = await window.argent.editor.requestCodeActions(payload)
          return {
            actions: (response ?? []).map((action: LspCodeAction) => ({
              title: action.title,
              kind: action.kind,
              edit: action.edit ? toWorkspaceEdit(action.edit) : undefined,
            })),
            dispose: () => undefined,
          }
        },
      }),
    ]

    this.providerDisposables.set(languageId, providers)
  }
}

export const lspBridge = new LspBridge()
