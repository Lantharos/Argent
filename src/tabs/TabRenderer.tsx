import { Suspense, lazy } from 'react'
import type { AppTab, PromptAttachment, ProviderConfig } from '../types/argent'
import { AITab } from '../components/tabs/AITab'
import { BrowserTab } from '../components/tabs/BrowserTab'
import { TerminalTab } from '../components/tabs/TerminalTab'
import { GitTab } from '../components/tabs/GitTab'

const EditorTab = lazy(async () => {
  const mod = await import('../components/tabs/EditorTab')
  return { default: mod.EditorTab }
})

type Props = {
  tab: AppTab
  isActive?: boolean
  spaceId: string
  spaceKind: 'project' | 'global'
  cwd: string
  providers: ProviderConfig[]
  updateTab: (next: AppTab) => void
  openEditorFileInNewTab: (spaceId: string, afterTabId: string, filePath: string, content: string, language?: string) => void
  openBrowserPreviewTab: (spaceId: string, afterTabId: string, filePath: string) => Promise<void>
  sendAI: (
    providerId: string,
    messages: { role: 'user' | 'assistant'; content: string }[],
    cwd?: string,
    model?: string,
    attachments?: PromptAttachment[],
  ) => Promise<string>
}

export function TabRenderer({ tab, isActive = true, spaceId, spaceKind, cwd, providers, updateTab, openEditorFileInNewTab, openBrowserPreviewTab, sendAI }: Props) {
  if (tab.type === 'ai') {
    return (
      <AITab
        tab={tab}
        isActive={isActive}
        spaceKind={spaceKind}
        cwd={cwd}
        providers={providers}
        onChange={(next) => updateTab(next)}
        onSend={sendAI}
      />
    )
  }

  if (tab.type === 'browser') {
    return <BrowserTab tab={tab} cwd={cwd} onChange={(next) => updateTab(next)} />
  }

  if (tab.type === 'terminal') {
    return <TerminalTab tab={tab} isActive={isActive} onChange={(next) => updateTab(next)} />
  }

  if (tab.type === 'git') {
    return <GitTab tab={tab} isActive={isActive} onChange={(next) => updateTab(next)} />
  }

  return (
    <Suspense
      fallback={(
        <div className="grid h-full w-full place-items-center text-sm text-[#666]">
          Loading editor...
        </div>
      )}
    >
      <EditorTab
        tab={tab}
        cwd={cwd}
        isActive={isActive}
        onOpenInNewTab={(payload) => openEditorFileInNewTab(spaceId, tab.id, payload.filePath, payload.content, payload.language)}
        onOpenBrowserPreviewTab={(filePath) => openBrowserPreviewTab(spaceId, tab.id, filePath)}
        onChange={(next) => updateTab(next)}
      />
    </Suspense>
  )
}
