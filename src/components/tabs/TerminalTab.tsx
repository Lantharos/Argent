import { useCallback, useEffect, useRef } from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import 'xterm/css/xterm.css'
import type { TerminalTabData } from '../../types/opensmith'

type Props = {
  tab: TerminalTabData
  isActive: boolean
  onChange: (next: TerminalTabData) => void
}

const TERMINAL_HISTORY_LIMIT = 300_000
const HISTORY_FLUSH_MS = 120
const BACKSPACE_CHAR = String.fromCharCode(8)

function trimTrailingPowerShellPrompt(value: string): string {
  return value.replace(/(?:\r?\n)?PS [^\r\n>]+>\s*$/m, '')
}

function normalizeHistoryForReplay(value: string): string {
  const normalizedNewlines = value
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n/g, '\r\n')

  return normalizedNewlines
}

function sanitizeTerminalChunk(value: string): string {
  if (!value) {
    return value
  }

  return value.replace(/\x7f/g, '')
}

function sanitizeReplayChunk(value: string): string {
  if (!value) {
    return value
  }

  return value.replace(/\x7f/g, '').split(BACKSPACE_CHAR).join('')
}

export function TerminalTab({ tab, isActive, onChange }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const inputDisposeRef = useRef<{ dispose: () => void } | null>(null)
  const sessionIdRef = useRef<string | null>(tab.sessionId ?? null)
  const creatingSessionRef = useRef(false)
  const sessionReplayModeRef = useRef<Record<string, 'reuse' | 'new'>>({})
  const attachedSessionIdRef = useRef<string | null>(null)
  const latestTabRef = useRef<TerminalTabData>(tab)
  const onChangeRef = useRef(onChange)
  const pendingHistoryRef = useRef('')
  const historyFlushTimerRef = useRef<number | null>(null)

  const safeFit = useCallback(() => {
    const terminal = termRef.current
    const fitAddon = fitRef.current
    if (!terminal || !fitAddon || !terminal.element) {
      return false
    }

    try {
      fitAddon.fit()
      return true
    } catch {
      return false
    }
  }, [])

  const flushHistory = useCallback(() => {
    if (!pendingHistoryRef.current) {
      return
    }

    const current = latestTabRef.current
    const base = current.history ?? ''
    let nextHistory = `${base}${pendingHistoryRef.current}`
    pendingHistoryRef.current = ''

    if (nextHistory.length > TERMINAL_HISTORY_LIMIT) {
      nextHistory = nextHistory.slice(nextHistory.length - TERMINAL_HISTORY_LIMIT)
    }

    if (nextHistory !== base) {
      onChangeRef.current({ ...current, history: nextHistory })
    }
  }, [])

  const queueHistory = useCallback((chunk: string) => {
    pendingHistoryRef.current += chunk
    if (historyFlushTimerRef.current) {
      return
    }

    historyFlushTimerRef.current = window.setTimeout(() => {
      historyFlushTimerRef.current = null
      flushHistory()
    }, HISTORY_FLUSH_MS)
  }, [flushHistory])

  useEffect(() => {
    latestTabRef.current = tab
    onChangeRef.current = onChange
    sessionIdRef.current = tab.sessionId ?? null
  }, [onChange, tab])

  useEffect(() => {
    const terminal = new Terminal({
      cursorBlink: true,
      theme: {
        background: '#00000000',
        foreground: '#d7dce4',
      },
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 15,
      lineHeight: 1.3,
    })

    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)

    if (containerRef.current) {
      terminal.open(containerRef.current)
      safeFit()
    }

    termRef.current = terminal
    fitRef.current = fitAddon

    const resizeObserver = new ResizeObserver(() => {
      if (!safeFit()) {
        return
      }

      const sessionId = sessionIdRef.current
      if (sessionId) {
        void window.opensmith.terminal.resize(sessionId, terminal.cols, terminal.rows)
      }
    })

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current)
    }

    return () => {
      resizeObserver.disconnect()
      if (historyFlushTimerRef.current) {
        window.clearTimeout(historyFlushTimerRef.current)
        historyFlushTimerRef.current = null
      }
      flushHistory()
      inputDisposeRef.current?.dispose()
      inputDisposeRef.current = null
      fitRef.current = null
      termRef.current = null
      terminal.dispose()
    }
  }, [flushHistory, safeFit])

  useEffect(() => {
    if (creatingSessionRef.current) {
      return
    }

    let cancelled = false
    creatingSessionRef.current = true

    void (async () => {
      try {
        const existingSessionId = tab.sessionId
        if (existingSessionId) {
          const alive = await window.opensmith.terminal.write(existingSessionId, '')
          if (alive) {
            sessionReplayModeRef.current[existingSessionId] = 'reuse'
            return
          }
        }

        const created = await window.opensmith.terminal.create(tab.cwd)
        sessionReplayModeRef.current[created.id] = 'new'
        if (!cancelled) {
          onChangeRef.current({ ...latestTabRef.current, sessionId: created.id })
        }
      } finally {
        creatingSessionRef.current = false
      }
    })()

    return () => {
      cancelled = true
    }
  }, [tab.sessionId, tab.cwd])

  useEffect(() => {
    if (!tab.sessionId) {
      return
    }

    const sessionId = tab.sessionId
    if (attachedSessionIdRef.current === sessionId) {
      return
    }
    attachedSessionIdRef.current = sessionId

    const replayMode = sessionReplayModeRef.current[sessionId] ?? 'reuse'

    const terminal = termRef.current
    if (!terminal) {
      return
    }

    const savedHistory = latestTabRef.current.history ?? ''
    const replayHistory = replayMode === 'new' ? trimTrailingPowerShellPrompt(savedHistory) : savedHistory
    const replayText = sanitizeReplayChunk(normalizeHistoryForReplay(replayHistory))
    if (replayText) {
      terminal.write(replayText)
    }

    let hasReceivedOutput = false
    let promptTimer: number | null = null
    let fitTimer: number | null = null

    const unsubData = window.opensmith.terminal.onData((payload) => {
      const current = termRef.current
      if (!current) {
        return
      }

      if (payload.id === sessionId) {
        hasReceivedOutput = true
        const sanitizedData = sanitizeTerminalChunk(payload.data)
        current.write(sanitizedData)
        queueHistory(sanitizedData)
      }
    })

    const unsubExit = window.opensmith.terminal.onExit((payload) => {
      const current = termRef.current
      if (!current) {
        return
      }

      if (payload.id === sessionId) {
        const line = `\r\n[process exited: ${payload.code}]\r\n`
        current.write(line)
        queueHistory(line)
      }
    })

    inputDisposeRef.current?.dispose()
    inputDisposeRef.current = terminal.onData((value) => {
      void window.opensmith.terminal.write(sessionId, value)
    })

    if (!replayText) {
      promptTimer = window.setTimeout(() => {
        if (!hasReceivedOutput && !pendingHistoryRef.current) {
          void window.opensmith.terminal.write(sessionId, '\r')
        }
      }, 320)
    }

    fitTimer = window.setTimeout(() => {
      if (!safeFit()) {
        return
      }

      const current = termRef.current
      if (current) {
        void window.opensmith.terminal.resize(sessionId, current.cols, current.rows)
      }
    }, 50)

    return () => {
      if (promptTimer) {
        window.clearTimeout(promptTimer)
      }
      if (fitTimer) {
        window.clearTimeout(fitTimer)
      }
      unsubData()
      unsubExit()
      flushHistory()
      inputDisposeRef.current?.dispose()
      inputDisposeRef.current = null
      if (attachedSessionIdRef.current === sessionId) {
        attachedSessionIdRef.current = null
      }
    }
  }, [flushHistory, queueHistory, safeFit, tab.sessionId])

  useEffect(() => {
    if (!isActive) {
      return
    }

    const timerId = window.setTimeout(() => {
      if (!safeFit()) {
        return
      }

      const sessionId = sessionIdRef.current
      const current = termRef.current
      if (sessionId && current) {
        void window.opensmith.terminal.resize(sessionId, current.cols, current.rows)
      }
      termRef.current?.focus()
    }, 30)

    return () => {
      window.clearTimeout(timerId)
    }
  }, [isActive, safeFit])

  return (
    <section className="tab-pane terminal-tab">
      <div className="terminal-frame glass-panel p-3">
        <div ref={containerRef} className="h-full w-full" />
      </div>
    </section>
  )
}
