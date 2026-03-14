export function EmptyState({ onCreateSpace }: { onCreateSpace: () => void }) {
  return (
    <section className="flex flex-col items-center justify-center p-8 text-center text-[#a0a0a0] h-full w-full bg-transparent [-webkit-app-region:no-drag]">
      <h1 className="m-0 text-3xl font-semibold text-white tracking-tight mb-3">OpenSmith</h1>
      <p>Open a folder to start a project group and add tabs in the sidebar.</p>
      <button className="primary-btn" onClick={onCreateSpace}>
        Open Folder as Space
      </button>
    </section>
  )
}
