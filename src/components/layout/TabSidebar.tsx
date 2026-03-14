import type { AppSpace, AppTabType } from '../../types/opensmith'

type Props = {
  space: AppSpace
  onSelectTab: (tabId: string) => void
  onCloseTab: (tabId: string) => void
  onAddTab: (type: AppTabType) => void
}

export function TabSidebar({ space, onSelectTab, onCloseTab, onAddTab }: Props) {
  return (
    <aside className="glass-panel w-64 flex flex-col gap-4 p-3 h-full overflow-hidden">
      <div className="flex flex-wrap gap-2 shrink-0">
        <button className="chip-btn" onClick={() => onAddTab('ai')}>+ AI</button>
        <button className="chip-btn" onClick={() => onAddTab('browser')}>+ Browser</button>
        <button className="chip-btn" onClick={() => onAddTab('terminal')}>+ Terminal</button>
        <button className="chip-btn" onClick={() => onAddTab('editor')}>+ Editor</button>
        <button className="chip-btn" onClick={() => onAddTab('git')}>+ Git</button>
      </div>

      <div className="flex flex-col gap-1 overflow-y-auto flex-1 h-full min-h-0">
        {space.tabs.map((tab) => (
          <div key={tab.id} className={`flex justify-between items-center gap-2 p-1.5 rounded-md transition-colors ${space.activeTabId === tab.id ? 'bg-white/10 text-white' : 'hover:bg-white/5 text-[#bebebe]'}`}>
            <button className="flex-1 flex items-center gap-2 text-left truncate text-sm min-w-0" onClick={() => onSelectTab(tab.id)}>
              <span className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded bg-white/8 text-[11px] text-[#c7c7c7]">
                {tab.type.slice(0, 1).toUpperCase()}
              </span>
              <span className="truncate">{tab.title}</span>
            </button>
            <button className="shrink-0 p-1 rounded-md hover:bg-white/12 text-[#9a9a9a] hover:text-white transition-colors" onClick={() => onCloseTab(tab.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
    </aside>
  )
}

