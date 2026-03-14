import { useMemo, useState } from 'react'
import type { ProviderConfig } from '../../types/opensmith'

type Props = {
  providers: ProviderConfig[]
  onUpsert: (provider: ProviderConfig) => Promise<void>
  onRemove: (providerId: string) => Promise<void>
}

const EMPTY = {
  id: 'opencode-acp',
  label: 'OpenCode ACP',
  kind: 'acp-opencode' as const,
  model: 'opencode/big-pickle',
  endpoint: 'stdio://opencode-acp',
  headers: {} as Record<string, string>,
  apiKey: '',
}

export function ProviderPanel({ providers, onUpsert, onRemove }: Props) {
  const [draft, setDraft] = useState(EMPTY)
  const [headerKey, setHeaderKey] = useState('')
  const [headerValue, setHeaderValue] = useState('')

  const canSave = useMemo(() => {
    return draft.label.length > 1 && draft.model.length > 0 && draft.endpoint.length > 0
  }, [draft])

  async function save() {
    if (!canSave) {
      return
    }

    await onUpsert({
      ...draft,
      id: 'opencode-acp',
    })

    setDraft(EMPTY)
  }

  const inputClass =
    'w-full rounded-lg border border-white/10 bg-black/28 px-3 py-2 text-[#d4d4d4] text-sm outline-none focus:border-[#666666] focus:bg-black/45 transition-colors'

  return (
    <div className="glass-panel flex flex-col gap-3 px-5 md:px-12 lg:px-24 mb-5">
      <h3 className="m-0 text-[11px] font-medium text-[#7e7e7e] uppercase tracking-wider">Providers</h3>
      <div className="flex flex-col gap-2 overflow-auto max-h-[200px]">
        {providers.map((provider) => (
          <div key={provider.id} className="flex items-center justify-between gap-3 rounded-lg border border-white/8 bg-black/25 p-3 text-sm shadow-sm">
            <div>
              <strong>{provider.label}</strong>
              <div className="text-xs text-[#848484]">{provider.model}</div>
              <div className="text-xs text-[#848484]">{provider.endpoint}</div>
            </div>
            <button className="ghost-btn" onClick={() => onRemove(provider.id)}>
              Remove
            </button>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-3">
        <input
          className={inputClass}
          placeholder="Label"
          value={draft.label}
          onChange={(event) => setDraft((prev) => ({ ...prev, label: event.target.value }))}
        />
        <input
          className={inputClass}
          placeholder="Model"
          value={draft.model}
          onChange={(event) => setDraft((prev) => ({ ...prev, model: event.target.value }))}
        />
        <input
          className={inputClass}
          placeholder="Endpoint"
          value={draft.endpoint}
          onChange={(event) => setDraft((prev) => ({ ...prev, endpoint: event.target.value }))}
        />
        <input
          className={inputClass}
          type="password"
          placeholder="API Key"
          value={draft.apiKey}
          onChange={(event) => setDraft((prev) => ({ ...prev, apiKey: event.target.value }))}
        />
        <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
          <input
            className={inputClass}
            placeholder="Header Key"
            value={headerKey}
            onChange={(event) => setHeaderKey(event.target.value)}
          />
          <input
            className={inputClass}
            placeholder="Header Value"
            value={headerValue}
            onChange={(event) => setHeaderValue(event.target.value)}
          />
          <button
            className="chip-btn"
            onClick={() => {
              if (!headerKey || !headerValue) {
                return
              }
              setDraft((prev) => ({
                ...prev,
                headers: {
                  ...prev.headers,
                  [headerKey]: headerValue,
                },
              }))
              setHeaderKey('')
              setHeaderValue('')
            }}
          >
            Add Header
          </button>
        </div>
        <button className="primary-btn" onClick={save} disabled={!canSave}>
          Save Provider
        </button>
      </div>
    </div>
  )
}
