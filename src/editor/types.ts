export type EditorSupportKind = 'basic' | 'monaco' | 'lsp'

export type WorkspaceFeatureInfo = {
  workspacePath: string
  isGodotProject: boolean
  godotExecutable: string | null
}

export type LspServerState = {
  languageId: string
  status: 'builtin' | 'ready' | 'starting' | 'unavailable' | 'stopped'
  detail: string | null
  install?: {
    supported: boolean
    label?: string | null
    detail?: string | null
  } | null
}

export type LspPosition = {
  line: number
  character: number
}

export type LspRange = {
  start: LspPosition
  end: LspPosition
}

export type LspDiagnostic = {
  range: LspRange
  severity?: number
  code?: string | number
  source?: string
  message: string
}

export type LspTextEdit = {
  range: LspRange
  newText: string
}

export type LspWorkspaceEdit = {
  changes?: Record<string, LspTextEdit[]>
}

export type LspCompletionItem = {
  label: string
  kind?: number
  detail?: string
  documentation?: string
  sortText?: string
  filterText?: string
  insertText?: string
  insertTextFormat?: number
  textEdit?: LspTextEdit
}

export type LspHover = {
  contents?: unknown
  range?: LspRange
}

export type LspLocation = {
  uri: string
  range: LspRange
}

export type LspCodeAction = {
  title: string
  kind?: string
  edit?: LspWorkspaceEdit
}

export type EditorEvent =
  | {
      type: 'diagnostics'
      workspacePath: string
      filePath: string
      languageId: string
      diagnostics: LspDiagnostic[]
      server: LspServerState
    }
  | {
      type: 'status'
      workspacePath: string
      filePath: string | null
      languageId: string
      server: LspServerState
    }
  | {
      type: 'file-changed'
      filePath: string
    }

export type EditorCompletionRequest = {
  workspacePath: string
  filePath: string
  languageId: string
  position: LspPosition
}

export type EditorHoverRequest = EditorCompletionRequest

export type EditorDefinitionRequest = EditorCompletionRequest

export type EditorRenameRequest = EditorCompletionRequest & {
  newName: string
}

export type EditorFormattingRequest = {
  workspacePath: string
  filePath: string
  languageId: string
}

export type EditorCodeActionRequest = {
  workspacePath: string
  filePath: string
  languageId: string
  range: LspRange
  diagnostics: LspDiagnostic[]
}

export type EditorDocumentPayload = {
  workspacePath: string
  filePath: string
  languageId: string
  content: string
  version: number
}
