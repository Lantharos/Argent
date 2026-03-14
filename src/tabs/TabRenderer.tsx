import type { AppTab, ProviderConfig } from '../types/opensmith'
import { AITab } from '../components/tabs/AITab'
import { BrowserTab } from '../components/tabs/BrowserTab'
import { TerminalTab } from '../components/tabs/TerminalTab'
import { EditorTab } from '../components/tabs/EditorTab'

type Props = {
  tab: AppTab
  isActive?: boolean
  spaceId: string
  cwd: string
  providers: ProviderConfig[]
  updateTab: (next: AppTab) => void
  openEditorFileInNewTab: (spaceId: string, afterTabId: string, filePath: string, content: string) => void
  sendAI: (
    providerId: string,
    messages: { role: 'user' | 'assistant'; content: string }[],
    cwd?: string,
    model?: string,
  ) => Promise<string>
}

export function TabRenderer({ tab, isActive = true, spaceId, cwd, providers, updateTab, openEditorFileInNewTab, sendAI }: Props) {
  if (tab.type === 'ai') {
    return (
      <AITab
        tab={tab}
        isActive={isActive}
        cwd={cwd}
        providers={providers}
        onChange={(next) => updateTab(next)}
        onSend={sendAI}
      />
    )
  }

  if (tab.type === 'browser') {
    return <BrowserTab tab={tab} onChange={(next) => updateTab(next)} />
  }

  if (tab.type === 'terminal') {
    return <TerminalTab tab={tab} isActive={isActive} onChange={(next) => updateTab(next)} />
  }

  return (
    <EditorTab
      tab={tab}
      cwd={cwd}
      isActive={isActive}
      onOpenInNewTab={(payload) => openEditorFileInNewTab(spaceId, tab.id, payload.filePath, payload.content)}
      onChange={(next) => updateTab(next)}
    />
  )
}
