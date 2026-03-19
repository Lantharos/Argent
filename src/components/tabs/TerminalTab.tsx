import { useCallback, useEffect, useRef } from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import 'xterm/css/xterm.css'
import type { TerminalTabData } from '../../types/argent'

type Props = {
  tab: TerminalTabData
  isActive: boolean
  onChange: (next: TerminalTabData) => void
}

const TERMINAL_HISTORY_LIMIT = 300_000
const HISTORY_FLUSH_MS = 120
const BACKSPACE_CHAR = String.fromCharCode(8)
const DEFAULT_TERMINAL_TAB_TITLE = 'Terminal'
const WINDOWS_PATH_SEPARATOR = /[\\/]/u

function formatTerminalExecutableTitle(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  const normalized = trimmed.replace(/["']/g, '')
  const lastSegment = normalized.split(WINDOWS_PATH_SEPARATOR).filter(Boolean).at(-1) || normalized
  const withoutExtension = lastSegment.replace(/\.(exe|cmd|bat)$/i, '')
  const lowerName = withoutExtension.toLowerCase()

  if (lowerName === 'powershell') {
    return 'PowerShell'
  }
  if (lowerName === 'pwsh') {
    return 'PowerShell'
  }
  if (lowerName === 'cmd') {
    return 'Command Prompt'
  }
  if (lowerName === 'bash') {
    return 'Bash'
  }
  if (lowerName === 'zsh') {
    return 'Zsh'
  }
  if (lowerName === 'fish') {
    return 'Fish'
  }
  if (lowerName === 'nu') {
    return 'Nu'
  }

  if (WINDOWS_PATH_SEPARATOR.test(normalized) || /\.(exe|cmd|bat)$/i.test(normalized)) {
    return withoutExtension ? withoutExtension[0].toUpperCase() + withoutExtension.slice(1) : null
  }

  return null
}

function sanitizeTerminalTitle(value: string): string {
  const executableTitle = formatTerminalExecutableTitle(value)
  if (executableTitle) {
    return executableTitle
  }

  const normalized = Array.from(value)
    .filter((char) => {
      const code = char.charCodeAt(0)
      return (code >= 32 && code !== 127) || code > 159
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
  if (!normalized) {
    return DEFAULT_TERMINAL_TAB_TITLE
  }

  return normalized.length > 80 ? `${normalized.slice(0, 80).trimEnd()}...` : normalized
}

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
  const system = window.argent.system
  const useOpaqueTerminalSurface = system.platform === 'win32'
  const preferredLineHeight = system.platform === 'win32' ? 1.1 : 1.2
  const preferredFontFamily =
    system.platform === 'win32'
      ? '"Cascadia Mono", "Cascadia Code", Consolas, "JetBrains Mono", monospace'
      : '"JetBrains Mono", monospace'
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
  const resizeFrameRef = useRef<number | null>(null)
  const lastSizeRef = useRef<{ cols: number; rows: number } | null>(null)
  const lastReportedTitleRef = useRef(sanitizeTerminalTitle(tab.title || DEFAULT_TERMINAL_TAB_TITLE))
  const webglAddonRef = useRef<{ dispose: () => void; clearTextureAtlas?: () => void } | null>(null)
  const webglContextLossDisposeRef = useRef<{ dispose: () => void } | null>(null)

  const alignTerminalViewport = useCallback(() => {
    const container = containerRef.current
    if (!container) {
      return false
    }

    const bounds = container.getBoundingClientRect()
    const nextWidth = Math.max(0, Math.floor(bounds.width))
    const nextHeight = Math.max(0, Math.floor(bounds.height))
    if (nextWidth === 0 || nextHeight === 0) {
      return false
    }

    const widthStyle = `${nextWidth}px`
    const heightStyle = `${nextHeight}px`
    if (container.style.width !== widthStyle) {
      container.style.width = widthStyle
    }
    if (container.style.height !== heightStyle) {
      container.style.height = heightStyle
    }

    return true
  }, [])

  const safeFit = useCallback(() => {
    const terminal = termRef.current
    const fitAddon = fitRef.current
    if (!terminal || !fitAddon || !terminal.element) {
      return false
    }

    try {
      if (!alignTerminalViewport()) {
        return false
      }
      fitAddon.fit()
      return true
    } catch {
      return false
    }
  }, [alignTerminalViewport])

  const syncTerminalSize = useCallback(() => {
    const terminal = termRef.current
    if (!terminal || !safeFit()) {
      return false
    }

    const nextSize = { cols: terminal.cols, rows: terminal.rows }
    if (nextSize.cols <= 0 || nextSize.rows <= 0) {
      return false
    }

    const previousSize = lastSizeRef.current
    if (previousSize && previousSize.cols === nextSize.cols && previousSize.rows === nextSize.rows) {
      return true
    }

    lastSizeRef.current = nextSize
    const sessionId = sessionIdRef.current
    if (sessionId) {
      void window.argent.terminal.resize(sessionId, nextSize.cols, nextSize.rows)
    }

    return true
  }, [safeFit])

  const scheduleTerminalResize = useCallback(() => {
    if (resizeFrameRef.current !== null) {
      return
    }

    resizeFrameRef.current = window.requestAnimationFrame(() => {
      resizeFrameRef.current = null
      void syncTerminalSize()
    })
  }, [syncTerminalSize])

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
    lastReportedTitleRef.current = sanitizeTerminalTitle(tab.title || DEFAULT_TERMINAL_TAB_TITLE)
  }, [onChange, tab])

  useEffect(() => {
    const terminal = new Terminal({
      cursorBlink: true,
      allowTransparency: !useOpaqueTerminalSurface,
      theme: {
        background: useOpaqueTerminalSurface ? '#0b0b0b' : '#00000000',
        foreground: '#d7dce4',
      },
      fontFamily: preferredFontFamily,
      fontSize: 15,
      lineHeight: preferredLineHeight,
      letterSpacing: 0,
      customGlyphs: true,
      windowsPty:
        system.platform === 'win32'
          ? {
              backend: system.terminalBackend,
              buildNumber: system.windowsBuildNumber ?? undefined,
            }
          : undefined,
    })

    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)

    if (containerRef.current) {
      alignTerminalViewport()
      terminal.open(containerRef.current)
      scheduleTerminalResize()
    }

    termRef.current = terminal
    fitRef.current = fitAddon

    const titleDispose = terminal.onTitleChange((nextTitle) => {
      const sanitizedTitle = sanitizeTerminalTitle(nextTitle)
      if (sanitizedTitle === lastReportedTitleRef.current) {
        return
      }

      lastReportedTitleRef.current = sanitizedTitle
      onChangeRef.current({
        ...latestTabRef.current,
        title: sanitizedTitle,
      })
    })

    const resizeObserver = new ResizeObserver(() => {
      scheduleTerminalResize()
    })

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current)
    }

    let cancelled = false
    if (system.platform === 'win32') {
      void import('xterm-addon-webgl')
        .then(({ WebglAddon }) => {
          if (cancelled || !termRef.current) {
            return
          }

          const addon = new WebglAddon()
          webglAddonRef.current = addon
          terminal.loadAddon(addon)
          webglContextLossDisposeRef.current = addon.onContextLoss(() => {
            webglContextLossDisposeRef.current?.dispose()
            webglContextLossDisposeRef.current = null
            webglAddonRef.current?.dispose()
            webglAddonRef.current = null
          })
          scheduleTerminalResize()
        })
        .catch(() => {
          webglAddonRef.current = null
        })
    }

    return () => {
      cancelled = true
      const sessionId = sessionIdRef.current
      if (sessionId) {
        void window.argent.terminal.kill(sessionId)
        sessionIdRef.current = null
      }
      resizeObserver.disconnect()
      if (historyFlushTimerRef.current) {
        window.clearTimeout(historyFlushTimerRef.current)
        historyFlushTimerRef.current = null
      }
      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current)
        resizeFrameRef.current = null
      }
      flushHistory()
      inputDisposeRef.current?.dispose()
      inputDisposeRef.current = null
      webglContextLossDisposeRef.current?.dispose()
      webglContextLossDisposeRef.current = null
      webglAddonRef.current?.dispose()
      webglAddonRef.current = null
      titleDispose.dispose()
      fitRef.current = null
      termRef.current = null
      terminal.dispose()
    }
  }, [
    alignTerminalViewport,
    flushHistory,
    preferredLineHeight,
    preferredFontFamily,
    scheduleTerminalResize,
    system.platform,
    system.terminalBackend,
    system.windowsBuildNumber,
    useOpaqueTerminalSurface,
  ])

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
          const alive = await window.argent.terminal.write(existingSessionId, '')
          if (alive) {
            sessionReplayModeRef.current[existingSessionId] = 'reuse'
            return
          }
        }

        const created = await window.argent.terminal.create(tab.cwd)
        sessionReplayModeRef.current[created.id] = 'new'
        lastSizeRef.current = null
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
    lastSizeRef.current = null

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

    const unsubData = window.argent.terminal.onData((payload) => {
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

    const unsubExit = window.argent.terminal.onExit((payload) => {
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
      void window.argent.terminal.write(sessionId, value)
    })

    if (!replayText) {
      promptTimer = window.setTimeout(() => {
        if (!hasReceivedOutput && !pendingHistoryRef.current) {
          void window.argent.terminal.write(sessionId, '\r')
        }
      }, 320)
    }

    fitTimer = window.setTimeout(() => {
      webglAddonRef.current?.clearTextureAtlas?.()
      scheduleTerminalResize()
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
  }, [flushHistory, queueHistory, scheduleTerminalResize, tab.sessionId])

  useEffect(() => {
    if (!isActive) {
      return
    }

    const timerId = window.setTimeout(() => {
      scheduleTerminalResize()
      termRef.current?.focus()
    }, 30)

    return () => {
      window.clearTimeout(timerId)
    }
  }, [isActive, scheduleTerminalResize])

  return (
    <section className="tab-pane terminal-tab">
      <div
        className="terminal-frame p-3"
        style={useOpaqueTerminalSurface ? { backgroundColor: '#0b0b0b' } : undefined}
      >
        <div ref={containerRef} className="h-full w-full" />
      </div>
    </section>
  )
}
