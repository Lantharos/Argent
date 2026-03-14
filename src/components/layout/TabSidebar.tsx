import type { AppSpace, AppTabType } from '../../types/opensmith'

type Props = {
  space: AppSpace
  onSelectTab: (tabId: string) => void
  onCloseTab: (tabId: string) => void
  onAddTab: (type: AppTabType) => void
}

export function TabSidebar({ space, onSelectTab, onCloseTab, onAddTab }: Props) {
  return (
    <aside className="glass-panel flex flex-col gap-2 p-3">
      <div className="flex flex-wrap gap-2">
        <button className="chip-btn" onClick={() => onAddTab('ai')}>
          + AI
        </button>
        <button className="chip-btn" onClick={() => onAddTab('browser')}>
          + Browser
        </button>
        <button className="chip-btn" onClick={() => onAddTab('terminal')}>
          + Terminal
        </button>
        <button className="chip-btn" onClick={() => onAddTab('editor')}>
          + Editor
        </button>
      </div>

      <div className="flex flex-col gap-0.5 mt-1 mb-2 border-l border-white/12 pl-3">
        {space.tabs.map((tab) => (
          <div key={tab.id} className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md transition-colors ${space.activeTabId === tab.id ? 'text-[#e9e9e9] bg-white/12' : 'text-[#9a9a9a] hover:text-[#d7d7d7] hover:bg-white/8'}`}>
            <button className="flex items-center gap-2 min-w-0 text-left" onClick={() => onSelectTab(tab.id)}>
              <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-white/8 text-[11px] text-[#c7c7c7]">{tab.type.slice(0, 1).toUpperCase()}</span>
              <span>{tab.title}</span>
            </button>
            <button className="p-1 rounded-md hover:bg-white/12 text-[#9a9a9a] hover:text-white transition-colors" onClick={() => onCloseTab(tab.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
    </aside>
  )
}
