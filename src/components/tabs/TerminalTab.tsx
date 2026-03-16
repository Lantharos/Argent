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
  const latestTabRef = useRef<TerminalTabData>(tab)
  const pendingHistoryRef = useRef('')
  const historyFlushTimerRef = useRef<number | null>(null)

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
      onChange({ ...current, history: nextHistory })
    }
  }, [onChange])

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
    sessionIdRef.current = tab.sessionId ?? null
  }, [tab])

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
      fitAddon.fit()
    }

    termRef.current = terminal
    fitRef.current = fitAddon

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit()
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
      terminal.dispose()
    }
  }, [flushHistory])

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
          onChange({ ...latestTabRef.current, sessionId: created.id })
        }
      } finally {
        creatingSessionRef.current = false
      }
    })()

    return () => {
      cancelled = true
    }
  }, [onChange, tab.sessionId, tab.cwd])

  useEffect(() => {
    if (!tab.sessionId) {
      return
    }

    const sessionId = tab.sessionId
    const replayMode = sessionReplayModeRef.current[sessionId] ?? 'reuse'

    const terminal = termRef.current
    if (!terminal) {
      return
    }

    const savedHistory = tab.history ?? ''
    const replayHistory = replayMode === 'new' ? trimTrailingPowerShellPrompt(savedHistory) : savedHistory
    const replayText = sanitizeReplayChunk(normalizeHistoryForReplay(replayHistory))
    if (replayText) {
      terminal.write(replayText)
    }

    let hasReceivedOutput = false
    let promptTimer: number | null = null

    const unsubData = window.opensmith.terminal.onData((payload) => {
      if (payload.id === sessionId) {
        hasReceivedOutput = true
        const sanitizedData = sanitizeTerminalChunk(payload.data)
        terminal.write(sanitizedData)
        queueHistory(sanitizedData)
      }
    })

    const unsubExit = window.opensmith.terminal.onExit((payload) => {
      if (payload.id === sessionId) {
        const line = `\r\n[process exited: ${payload.code}]\r\n`
        terminal.write(line)
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

    window.setTimeout(() => {
      fitRef.current?.fit()
      const current = termRef.current
      if (current) {
        void window.opensmith.terminal.resize(sessionId, current.cols, current.rows)
      }
    }, 50)

    return () => {
      if (promptTimer) {
        window.clearTimeout(promptTimer)
      }
      unsubData()
      unsubExit()
      flushHistory()
      inputDisposeRef.current?.dispose()
      inputDisposeRef.current = null
    }
  }, [flushHistory, queueHistory, tab.history, tab.sessionId])

  useEffect(() => {
    if (!isActive) {
      return
    }

    window.setTimeout(() => {
      fitRef.current?.fit()
      const sessionId = sessionIdRef.current
      const current = termRef.current
      if (sessionId && current) {
        void window.opensmith.terminal.resize(sessionId, current.cols, current.rows)
      }
      termRef.current?.focus()
    }, 30)
  }, [isActive])

  return (
    <section className="tab-pane terminal-tab">
      <div className="terminal-frame glass-panel p-3">
        <div ref={containerRef} className="h-full w-full" />
      </div>
    </section>
  )
}
