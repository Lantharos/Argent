export function EmptyState({ onCreateSpace }: { onCreateSpace: () => void }) {
  return (
    <section className="tab-pane flex flex-col items-center justify-center p-8 text-center text-[#bebebe] [-webkit-app-region:no-drag]">
      <svg className="mb-4 h-12 w-12 text-[#b0b0b0]/80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 7a2 2 0 0 1 2-2h4.2l1.6 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <path d="M12 11v6" />
        <path d="M9 14h6" />
      </svg>
      <h2 className="mb-2 text-xl font-medium text-white">Open a Project Space</h2>
      <p className="mb-6 max-w-md text-[#888]">
        Open a folder to start a project space and add tabs in the sidebar.
      </p>
      <button className="primary-btn px-4 py-2" onClick={onCreateSpace}>
        Open Folder as Space
      </button>
    </section>
  )
}
