import type {
  EditorCodeActionRequest,
  EditorCompletionRequest,
  EditorDefinitionRequest,
  EditorDocumentPayload,
  EditorEvent,
  EditorFormattingRequest,
  EditorHoverRequest,
  EditorRenameRequest,
  LspCodeAction,
  LspCompletionItem,
  LspHover,
  LspLocation,
  LspServerState,
  LspTextEdit,
  LspWorkspaceEdit,
  WorkspaceFeatureInfo,
} from '../editor/types'

export type ProviderKind = 'acp-opencode'

export type ProviderConfig = {
  id: string
  label: string
  kind: ProviderKind
  model: string
  endpoint: string
  headers: Record<string, string>
  apiKey?: string
  hasApiKey?: boolean
  source?: 'manual' | 'detected'
}

export type ChatMessage = {
  role: 'system' | 'developer' | 'user' | 'assistant'
  content: string
  attachments?: PromptAttachment[]
}

export type PromptAttachment =
  | {
      id: string
      kind: 'file'
      name: string
      path: string
      mimeType?: string
    }
  | {
      id: string
      kind: 'image'
      name: string
      data: string
      mimeType?: string
    }

export type AIReply = {
  id: string | null
  content: string
  model: string
  usage: unknown
}

export type AIStreamEvent =
  | { type: 'text-delta'; delta: string }
  | { type: 'thought-delta'; delta: string }
  | { type: 'commands'; commands: Array<{ name: string; description?: string }> }
  | {
      type: 'plan'
      entries: Array<{
        content: string
        status: 'pending' | 'in_progress' | 'completed' | 'cancelled' | string
        priority?: 'low' | 'medium' | 'high' | string | null
      }>
    }
  | {
      type: 'tool'
      id: string | null
      status: 'pending' | 'in_progress' | 'completed' | 'failed' | string
      kind?: string
      title: string
      detail?: string | null
    }
  | { type: 'done'; reply: AIReply }
  | { type: 'error'; message: string }

export type AppTabType = 'ai' | 'browser' | 'terminal' | 'editor' | 'git'

  export type AppTabBase = {
    id: string
    title: string
    type: AppTabType
  }

  export type GitTabData = AppTabBase & {
    type: 'git'
    cwd: string
}

export type AITabData = AppTabBase & {
  type: 'ai'
  providerId: string | null
  model: string | null
  acpModeId?: string | null
  acpSessionId?: string | null
  attachments?: PromptAttachment[]
  usageByModel?: Record<string, { usedTokens: number | null; maxTokens: number | null }>
  messages: ChatMessage[]
  input: string
  isGenerating?: boolean
  hasUnread?: boolean
}

export type BrowserTabData = AppTabBase & {
  type: 'browser'
  url: string
  faviconUrl: string | null
}

export type TerminalTabData = AppTabBase & {
  type: 'terminal'
  sessionId: string | null
  cwd: string
  history?: string
}

export type EditorTabData = AppTabBase & {
  type: 'editor'
  filePath: string | null
  content: string
  language: string
  dirty: boolean
  fontSize?: number
  sidebarOpen?: boolean
}

export type AppTab = AITabData | BrowserTabData | TerminalTabData | EditorTabData | GitTabData

export type SplitOrientation = 'vertical' | 'horizontal'

export type AppTabSplitLeaf = {
  id: string
  type: 'leaf'
  tabId: string
}

export type AppTabSplitBranch = {
  id: string
  type: 'split'
  orientation: SplitOrientation
  ratio?: number
  first: AppTabSplitNode
  second: AppTabSplitNode
}

export type AppTabSplitNode = AppTabSplitLeaf | AppTabSplitBranch

export type AppTabGroup = {
  id: string
  root: AppTabSplitNode
}

export type AppSpace = {
  id: string
  name: string
  rootPath: string
  kind?: 'project' | 'global'
  tabs: AppTab[]
  activeTabId: string
  secondaryTabId: string | null
  tabGroups?: AppTabGroup[]
  tabHistory?: string[]
}

export type AppSnapshot = {
  spaces: AppSpace[]
  activeSpaceId: string | null
}

declare global {
  interface Window {
    argent: {
      git: {
        checkInstalled: () => Promise<{ installed: boolean, version?: string, error?: string }>
        exec: (opts: { cwd: string, args: string[] }) => Promise<{ success: boolean, stdout?: string, stderr?: string, error?: string }>
        clone: (opts: { repoUrl: string; parentDir: string }) => Promise<{ success: boolean; path?: string; error?: string; stdout?: string; stderr?: string }>
      }
      app: {
        loadState: () => Promise<AppSnapshot>
        saveState: (state: AppSnapshot) => Promise<boolean>
        chooseFolder: () => Promise<string | null>
        openInExplorer: (targetPath: string) => Promise<boolean>
        getHomeDirectory: () => Promise<string>
        onOpenCommandPalette: (callback: () => void) => () => void
      }
      window: {
        minimize: () => Promise<boolean>
        maximizeToggle: () => Promise<boolean>
        close: () => Promise<boolean>
        getBounds: () => Promise<{ x: number; y: number; width: number; height: number; isMaximized: boolean } | null>
        setPosition: (x: number, y: number) => Promise<boolean>
        setNativeControlsVisible: (visible: boolean) => Promise<boolean>
      }
      providers: {
        list: () => Promise<ProviderConfig[]>
        upsert: (payload: ProviderConfig) => Promise<ProviderConfig>
        remove: (providerId: string) => Promise<boolean>
      }
      ai: {
        sendMessage: (payload: {
          providerId: string
          messages: ChatMessage[]
          attachments?: PromptAttachment[]
          model?: string
          modeId?: string
          temperature?: number
          cwd?: string
          sessionId?: string
        }) => Promise<AIReply>
        streamStart: (payload: {
          providerId: string
          messages: ChatMessage[]
          attachments?: PromptAttachment[]
          model?: string
          modeId?: string
          temperature?: number
          cwd?: string
          sessionId?: string
        }) => Promise<{ requestId: string }>
        streamCancel: (payload: { requestId: string }) => Promise<boolean>
        listModels: (payload: { providerId: string; cwd?: string }) => Promise<Array<{ id: string; label: string; contextWindow?: number | null }>>
        listCommands: (payload: { providerId: string; cwd?: string; sessionId?: string }) => Promise<Array<{ name: string; description?: string }>>
        listModes: (payload: { providerId: string; cwd?: string; sessionId?: string }) => Promise<{ sessionId: string | null; currentModeId: string | null; modes: Array<{ id: string; name: string; description?: string }> }>
        setMode: (payload: { providerId: string; cwd?: string; sessionId?: string; modeId: string }) => Promise<{ sessionId: string; modeId: string }>
        getCliStatus: () => Promise<{ installed: boolean; version: string | null; installMethods: Array<{ id: string; label: string; detail: string }> }>
        installCli: (payload: { methodId: string }) => Promise<{ installed: boolean; version: string | null; installMethods: Array<{ id: string; label: string; detail: string }> }>
        onStreamEvent: (callback: (payload: { requestId: string; event: AIStreamEvent }) => void) => () => void
      }
      terminal: {
        create: (cwd: string) => Promise<{ id: string }>
        write: (id: string, data: string) => Promise<boolean>
        resize: (id: string, cols: number, rows: number) => Promise<boolean>
        kill: (id: string) => Promise<boolean>
        onData: (callback: (payload: { id: string; data: string }) => void) => () => void
        onExit: (callback: (payload: { id: string; code: number | null }) => void) => () => void
      }
      editor: {
        detectWorkspace: (workspacePath: string) => Promise<WorkspaceFeatureInfo>
        getServerStatus: (payload: { workspacePath: string; languageId: string }) => Promise<LspServerState>
        installServer: (payload: { workspacePath: string; languageId: string }) => Promise<{ success: boolean; message: string }>
        startServer: (payload: { workspacePath: string; languageId: string; filePath?: string | null }) => Promise<{ success: boolean; message: string }>
        openDocument: (payload: EditorDocumentPayload) => Promise<boolean | null>
        changeDocument: (payload: EditorDocumentPayload) => Promise<boolean | null>
        closeDocument: (payload: Omit<EditorDocumentPayload, 'content' | 'version'>) => Promise<boolean | null>
        requestCompletion: (payload: EditorCompletionRequest) => Promise<LspCompletionItem[]>
        requestHover: (payload: EditorHoverRequest) => Promise<LspHover | null>
        requestDefinition: (payload: EditorDefinitionRequest) => Promise<LspLocation[]>
        requestRename: (payload: EditorRenameRequest) => Promise<LspWorkspaceEdit | null>
        requestFormatting: (payload: EditorFormattingRequest) => Promise<LspTextEdit[]>
        requestCodeActions: (payload: EditorCodeActionRequest) => Promise<LspCodeAction[]>
        launchGodotEditor: (workspacePath: string) => Promise<boolean>
        runGodotProject: (workspacePath: string) => Promise<boolean>
        onEvent: (callback: (payload: EditorEvent) => void) => () => void
      }
      fs: {
        openFile: (cwd: string | null) => Promise<string | null>
        readFile: (path: string) => Promise<string>
        saveFile: (path: string, content: string) => Promise<boolean>
        readDir: (path: string) => Promise<{name: string, isDirectory: boolean, path: string}[]>
        delete: (path: string) => Promise<boolean>
        copy: (src: string, dest: string) => Promise<boolean>
        move: (src: string, dest: string) => Promise<boolean>
      }
    }
  }
}
