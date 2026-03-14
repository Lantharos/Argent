export type ProviderKind = 'openai-compatible' | 'codex-app-server' | 'copilot-sdk'

export type ProviderConfig = {
  id: string
  label: string
  kind: ProviderKind
  model: string
  endpoint: string
  headers: Record<string, string>
  apiKey?: string
  hasApiKey?: boolean
}

export type ChatMessage = {
  role: 'system' | 'developer' | 'user' | 'assistant'
  content: string
}

export type AIReply = {
  id: string | null
  content: string
  model: string
  usage: unknown
}

export type AppTabType = 'ai' | 'browser' | 'terminal' | 'editor'

export type AppTabBase = {
  id: string
  title: string
  type: AppTabType
}

export type AITabData = AppTabBase & {
  type: 'ai'
  providerId: string | null
  model: string | null
  messages: ChatMessage[]
  input: string
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
}

export type AppTab = AITabData | BrowserTabData | TerminalTabData | EditorTabData

export type AppSpace = {
  id: string
  name: string
  rootPath: string
  tabs: AppTab[]
  activeTabId: string
  secondaryTabId: string | null
}

export type AppSnapshot = {
  spaces: AppSpace[]
  activeSpaceId: string | null
}

declare global {
  interface Window {
    opensmith: {
      app: {
        loadState: () => Promise<AppSnapshot>
        saveState: (state: AppSnapshot) => Promise<boolean>
        chooseFolder: () => Promise<string | null>
      }
      window: {
        minimize: () => Promise<boolean>
        maximizeToggle: () => Promise<boolean>
        close: () => Promise<boolean>
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
          model?: string
          temperature?: number
          cwd?: string
        }) => Promise<AIReply>
        listModels: (payload: { providerId: string; cwd?: string }) => Promise<Array<{ id: string; label: string }>>
      }
      terminal: {
        create: (cwd: string) => Promise<{ id: string }>
        write: (id: string, data: string) => Promise<boolean>
        resize: (id: string, cols: number, rows: number) => Promise<boolean>
        kill: (id: string) => Promise<boolean>
        onData: (callback: (payload: { id: string; data: string }) => void) => () => void
        onExit: (callback: (payload: { id: string; code: number | null }) => void) => () => void
      }
      fs: {
        openFile: (cwd: string | null) => Promise<string | null>
        readFile: (path: string) => Promise<string>
        saveFile: (path: string, content: string) => Promise<boolean>
      }
    }
  }
}
