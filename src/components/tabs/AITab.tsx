import { useEffect, useMemo, useRef, useState } from 'react'
import type { AITabData, ProviderConfig } from '../../types/opensmith'

type Props = {
  tab: AITabData
  cwd: string
  providers: ProviderConfig[]
  onChange: (next: AITabData) => void
  onSend: (
    providerId: string,
    messages: { role: 'user' | 'assistant'; content: string }[],
    cwd?: string,
    model?: string,
  ) => Promise<string>
}

export function AITab({ tab, cwd, providers, onChange, onSend }: Props) {
  const [loading, setLoading] = useState(false)
  const [providerMenuOpen, setProviderMenuOpen] = useState(false)
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [activeMetaPopover, setActiveMetaPopover] = useState<'local' | 'access' | null>(null)
  const providerMenuRef = useRef<HTMLDivElement | null>(null)
  const modelMenuRef = useRef<HTMLDivElement | null>(null)
  const [modelOptions, setModelOptions] = useState<Array<{ id: string; label: string }>>([])

  const preferredProviders = useMemo(() => {
    const codex = providers.find((provider) => provider.id === 'codex-app-server')
    const copilot = providers.find((provider) => provider.id === 'copilot-sdk')
    const selected = [codex, copilot].filter((item): item is ProviderConfig => Boolean(item))
    return selected.length > 0 ? selected : providers
  }, [providers])

  const selectedProvider = useMemo(() => {
    if (!tab.providerId) {
      return preferredProviders.at(0) ?? null
    }
    return preferredProviders.find((provider) => provider.id === tab.providerId) ?? preferredProviders.at(0) ?? null
  }, [preferredProviders, tab.providerId])

  const selectedProviderLabel = selectedProvider?.label ?? 'Select provider'
  const selectedModelValue = tab.model || selectedProvider?.model || null
  const selectedModelLabel =
    modelOptions.find((item) => item.id === selectedModelValue)?.label || selectedModelValue || 'Select model'

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null
      if (!target) {
        return
      }
      if (providerMenuRef.current?.contains(target)) {
        return
      }
      if (modelMenuRef.current?.contains(target)) {
        return
      }
      setProviderMenuOpen(false)
      setModelMenuOpen(false)
      setActiveMetaPopover(null)
    }

    window.addEventListener('pointerdown', handlePointerDown)
    return () => window.removeEventListener('pointerdown', handlePointerDown)
  }, [])

  useEffect(() => {
    async function loadModels() {
      if (!selectedProvider) {
        setModelOptions([])
        return
      }

      try {
        const models = await window.opensmith.ai.listModels({ providerId: selectedProvider.id, cwd })
        setModelOptions(models)
        if (!tab.model && models.length > 0) {
          onChange({ ...tab, providerId: selectedProvider.id, model: models[0].id })
        }
      } catch {
        setModelOptions([{ id: selectedProvider.model, label: selectedProvider.model }])
      }
    }

    void loadModels()
  }, [selectedProvider?.id, cwd])

  async function addFileContext() {
    const picked = await window.opensmith.fs.openFile(null)
    if (!picked) {
      return
    }
    const content = await window.opensmith.fs.readFile(picked)
    const name = picked.split(/[/\\]/).at(-1) ?? picked
    const block = `\n\n--- FILE: ${name} (${picked}) ---\n${content}\n--- END FILE ---\n`
    onChange({ ...tab, input: `${tab.input}${block}` })
  }

  async function handleSend() {
    const input = tab.input.trim()
    if (!selectedProvider || input.length === 0 || loading) {
      return
    }

    const withUser: AITabData['messages'] = [...tab.messages, { role: 'user', content: input }]
    onChange({ ...tab, input: '', providerId: selectedProvider.id, messages: withUser })

    setLoading(true)
    try {
      const usable = withUser.filter(
        (msg): msg is { role: 'user' | 'assistant'; content: string } =>
          msg.role === 'user' || msg.role === 'assistant',
      )
      const content = await onSend(selectedProvider.id, usable, cwd, tab.model || selectedProvider.model)
      const withAssistant: AITabData['messages'] = [...withUser, { role: 'assistant', content }]
      onChange({ ...tab, input: '', providerId: selectedProvider.id, messages: withAssistant })
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="tab-pane ai-tab">
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto px-5 md:px-12 lg:px-24 pt-5">
        {tab.messages.length === 0 ? (
          <div className="w-full max-w-[760px] mx-auto mt-10 md:mt-16 px-2 text-center">
            <h2 className="m-0 text-[30px] leading-tight font-semibold tracking-tight text-[#efefef]">What do you want to build?</h2>
            <p className="mt-3 mb-0 text-[14px] text-[#9a9a9a]">Describe an app, feature, bug fix, or refactor and I can plan and execute it.</p>
          </div>
        ) : null}
        {tab.messages.map((message, index) => (
          <div
            key={index}
            className={
              message.role === 'user'
                ? 'py-1 border-none ml-auto bg-white/12 shadow-sm ring-1 ring-white/10 rounded-2xl px-4 py-2.5 text-white max-w-[75%]'
                : 'py-1 px-0 border-none mr-auto bg-transparent text-[#b6b6b6] flex-1 w-full max-w-full'
            }
          >
            {message.content}
          </div>
        ))}
      </div>

      <form
        className="w-full px-5 md:px-12 lg:px-24 pb-5"
        onSubmit={(event) => {
          event.preventDefault()
          void handleSend()
        }}
      >
        <div
          className="flex flex-col w-full rounded-3xl border border-[#2f2f2f] hover:border-[#3a3a3a] focus-within:border-[#4a4a4a] transition px-1 bg-[#1c1c1c]/96 text-[#e5e5e5] shadow-[0_10px_30px_rgba(0,0,0,0.35)]"
          dir="auto"
        >
          <div className="px-2.5">
            <textarea
              className="w-full bg-transparent outline-none border-0 resize-none text-[15px] text-[#ebebeb] placeholder:text-[#7f7f7f] pt-2.5 pb-[6px] px-1 min-h-[72px] max-h-72 overflow-auto"
              value={tab.input}
              onChange={(event) => onChange({ ...tab, input: event.target.value })}
              placeholder="Ask OpenSmith anything, @ to add files, / for commands"
              rows={3}
            />
          </div>

          <div className="flex items-center justify-between mb-2.5 mx-0.5 border-t border-[#2c2c2c] pt-2">
            <div className="flex items-center gap-1.5">
              <button type="button" className="bg-transparent hover:bg-white/8 text-[#b8b8b8] transition rounded-full p-1.5 outline-none" onClick={addFileContext} aria-label="Add file">
                <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                  <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
                </svg>
              </button>

              <div className="relative" ref={providerMenuRef}>
                <button
                  type="button"
                  className="rounded-lg border border-[#383838] bg-[#1a1a1a] px-2 py-1.5 text-sm text-[#d7d7d7] outline-none focus:border-[#5c5c5c] inline-flex items-center gap-1.5 min-w-[200px] justify-between"
                  onClick={() => setProviderMenuOpen((prev) => !prev)}
                  aria-haspopup="listbox"
                  aria-expanded={providerMenuOpen}
                >
                  <span className="truncate">{selectedProviderLabel}</span>
                  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5">
                    <path d="M5.5 7.5 10 12l4.5-4.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>

                {providerMenuOpen ? (
                  <div className="absolute left-0 bottom-[calc(100%+8px)] min-w-[220px] rounded-xl border border-[#363636] bg-[#181818] p-1.5 shadow-[0_16px_40px_rgba(0,0,0,0.45)] z-40" role="listbox">
                    {preferredProviders.map((provider) => (
                      <button
                        key={provider.id}
                        type="button"
                        className={`w-full text-left rounded-lg px-3 py-2 text-sm transition-colors ${selectedProvider?.id === provider.id ? 'bg-[#2f2f2f] text-[#efefef]' : 'text-[#c4c4c4] hover:bg-[#2a2a2a]'}`}
                        onClick={() => {
                          onChange({ ...tab, providerId: provider.id, model: null })
                          setProviderMenuOpen(false)
                        }}
                      >
                        {provider.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="relative" ref={modelMenuRef}>
                <button
                  type="button"
                  className="rounded-lg border border-[#383838] bg-[#1a1a1a] px-2 py-1.5 text-sm text-[#d7d7d7] outline-none focus:border-[#5c5c5c] inline-flex items-center gap-1.5 min-w-[200px] justify-between"
                  onClick={() => setModelMenuOpen((prev) => !prev)}
                  aria-haspopup="listbox"
                  aria-expanded={modelMenuOpen}
                >
                  <span className="truncate">{selectedModelLabel}</span>
                  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5">
                    <path d="M5.5 7.5 10 12l4.5-4.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>

                {modelMenuOpen ? (
                  <div className="absolute left-0 bottom-[calc(100%+8px)] min-w-[220px] rounded-xl border border-[#363636] bg-[#181818] p-1.5 shadow-[0_16px_40px_rgba(0,0,0,0.45)] z-40" role="listbox">
                    {modelOptions.map((model) => (
                      <button
                        key={model.id}
                        type="button"
                        className={`w-full text-left rounded-lg px-3 py-2 text-sm transition-colors ${selectedModelValue === model.id ? 'bg-[#2f2f2f] text-[#efefef]' : 'text-[#c4c4c4] hover:bg-[#2a2a2a]'}`}
                        onClick={() => {
                          onChange({ ...tab, model: model.id })
                          setModelMenuOpen(false)
                        }}
                      >
                        {model.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <div className="relative">
                <button
                  type="button"
                  className="text-xs text-[#959595] inline-flex items-center gap-1 rounded-full border border-[#3a3a3a] bg-[#1b1b1b] px-2 py-1 hover:bg-[#242424] transition-colors"
                  onClick={() => setActiveMetaPopover((prev) => (prev === 'local' ? null : 'local'))}
                >
                  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5">
                    <rect x="3" y="4" width="14" height="10" rx="1.5" />
                    <path d="M7 16h6" />
                  </svg>
                  Local
                </button>
                {activeMetaPopover === 'local' ? (
                  <div className="absolute right-0 bottom-[calc(100%+8px)] w-[220px] rounded-xl border border-[#353535] bg-[#161616] px-3 py-2 text-[12px] leading-relaxed text-[#b9b9b9] shadow-[0_14px_30px_rgba(0,0,0,0.45)] z-40" role="status">
                    Uses files from the active workspace path only.
                  </div>
                ) : null}
              </div>

              <div className="relative">
                <button
                  type="button"
                  className="text-xs text-[#aaaaaa] inline-flex items-center gap-1 rounded-full border border-[#3a3a3a] bg-[#1b1b1b] px-2 py-1 hover:bg-[#242424] transition-colors"
                  onClick={() => setActiveMetaPopover((prev) => (prev === 'access' ? null : 'access'))}
                >
                  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5">
                    <path d="M10 2.5v7" />
                    <path d="M10 13.5h.01" />
                    <path d="M3.7 16.5h12.6c.8 0 1.3-.9.9-1.6L10.9 3.9a1 1 0 0 0-1.8 0L2.8 14.9c-.4.7.1 1.6.9 1.6Z" />
                  </svg>
                  Full access
                </button>
                {activeMetaPopover === 'access' ? (
                  <div className="absolute right-0 bottom-[calc(100%+8px)] w-[220px] rounded-xl border border-[#353535] bg-[#161616] px-3 py-2 text-[12px] leading-relaxed text-[#b9b9b9] shadow-[0_14px_30px_rgba(0,0,0,0.45)] z-40" role="status">
                    Model tools can read and write files in this space.
                  </div>
                ) : null}
              </div>

              <button
                className="bg-[#b0b0b0] text-[#151515] hover:bg-[#c8c8c8] transition rounded-full size-9 flex items-center justify-center text-base font-semibold disabled:opacity-45 disabled:hover:bg-[#b0b0b0]"
                type="submit"
                disabled={loading || !selectedProvider || tab.input.trim().length === 0}
              >
                {loading ? (
                  <span className="leading-none">…</span>
                ) : (
                  <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                    <path d="M10 2.75a.75.75 0 0 1 .75.75v10.44l3.22-3.22a.75.75 0 1 1 1.06 1.06l-4.5 4.5a.75.75 0 0 1-1.06 0l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.22 3.22V3.5a.75.75 0 0 1 .75-.75Z" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>
      </form>
    </section>
  )
}
