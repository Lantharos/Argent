import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BrowserTabData } from '../../types/opensmith'

type BrowserWebview = HTMLElement & {
  getURL: () => string
  canGoBack: () => boolean
  canGoForward: () => boolean
  getTitle: () => string
  goBack: () => void
  goForward: () => void
  reloadIgnoringCache: () => void
}

type TitleUpdatedEvent = Event & {
  title?: string
}

type FaviconUpdatedEvent = Event & {
  favicons?: string[]
}

type Props = {
  tab: BrowserTabData
  onChange: (next: BrowserTabData) => void
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}

export function BrowserTab({ tab, onChange }: Props) {
  const [urlInputDraft, setUrlInputDraft] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)
  const viewRef = useRef<HTMLElement | null>(null)
  const domReadyRef = useRef(false)
  const urlInput = urlInputDraft ?? tab.url

  const safeUrl = useMemo(() => {
    if (isHttpUrl(tab.url)) {
      return tab.url
    }
    return 'https://www.google.com'
  }, [tab.url])

  const updateTabPatch = useCallback((patch: Partial<BrowserTabData>) => {
    const next: BrowserTabData = { ...tab, ...patch }
    if (
      next.url === tab.url
      && next.title === tab.title
      && next.faviconUrl === tab.faviconUrl
    ) {
      return
    }
    onChange(next)
  }, [onChange, tab])

  function resolveNavigationTarget(rawInput: string): string {
    const value = rawInput.trim()
    if (!value) {
      return tab.url
    }

    if (/^https?:\/\//i.test(value)) {
      try {
        const parsed = new URL(value)
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
          return parsed.toString()
        }
      } catch {
        return `https://www.google.com/search?q=${encodeURIComponent(value)}`
      }
    }

    if (!/\s/.test(value) && (/\./.test(value) || /^localhost(?::\d+)?$/i.test(value) || /^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?$/.test(value))) {
      const protocol = /^localhost(?::\d+)?$/i.test(value) || /^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?$/.test(value) ? 'http://' : 'https://'
      const candidate = `${protocol}${value}`
      try {
        const parsed = new URL(candidate)
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
          return parsed.toString()
        }
      } catch {
        return `https://www.google.com/search?q=${encodeURIComponent(value)}`
      }
    }

    return `https://www.google.com/search?q=${encodeURIComponent(value)}`
  }

  function commitUrl() {
    const next = resolveNavigationTarget(urlInput)
    setUrlInputDraft(null)
    updateTabPatch({ url: next })
  }

  function withReadyWebview<T>(action: (webview: BrowserWebview) => T): T | null {
    const webview = viewRef.current
    if (!webview || !domReadyRef.current) {
      return null
    }

    const candidate = webview as Partial<BrowserWebview>
    if (
      typeof candidate.getURL !== 'function'
      || typeof candidate.canGoBack !== 'function'
      || typeof candidate.canGoForward !== 'function'
      || typeof candidate.getTitle !== 'function'
      || typeof candidate.goBack !== 'function'
      || typeof candidate.goForward !== 'function'
      || typeof candidate.reloadIgnoringCache !== 'function'
    ) {
      return null
    }

    try {
      return action(candidate as BrowserWebview)
    } catch {
      return null
    }
  }

  useEffect(() => {
    const webview = viewRef.current
    if (!webview) {
      return
    }

    const syncNavState = () => {
      const nextUrl = withReadyWebview((current) => current.getURL())
      if (!nextUrl || !isHttpUrl(nextUrl)) {
        return
      }

      const back = withReadyWebview((current) => current.canGoBack())
      const forward = withReadyWebview((current) => current.canGoForward())
      const nextTitle = withReadyWebview((current) => current.getTitle())

      setCanGoBack(Boolean(back))
      setCanGoForward(Boolean(forward))
      setUrlInputDraft(nextUrl)
      const host = (() => {
        try {
          return new URL(nextUrl).hostname.replace(/^www\./, '')
        } catch {
          return 'Browser'
        }
      })()
      updateTabPatch({ url: nextUrl, title: nextTitle || host })
    }

    const onDomReady = () => {
      domReadyRef.current = true
      syncNavState()
    }

    const onTitle = (event: TitleUpdatedEvent) => {
      const title = (event?.title ?? '').trim()
      if (title) {
        updateTabPatch({ title })
      }
    }

    const onFavicon = (event: FaviconUpdatedEvent) => {
      const favicon = event?.favicons?.[0] ?? null
      updateTabPatch({ faviconUrl: favicon })
    }

    webview.addEventListener('did-navigate', syncNavState)
    webview.addEventListener('did-navigate-in-page', syncNavState)
    webview.addEventListener('did-finish-load', syncNavState)
    webview.addEventListener('page-title-updated', onTitle)
    webview.addEventListener('page-favicon-updated', onFavicon)
    webview.addEventListener('dom-ready', onDomReady)

    return () => {
      webview.removeEventListener('did-navigate', syncNavState)
      webview.removeEventListener('did-navigate-in-page', syncNavState)
      webview.removeEventListener('did-finish-load', syncNavState)
      webview.removeEventListener('page-title-updated', onTitle)
      webview.removeEventListener('page-favicon-updated', onFavicon)
      webview.removeEventListener('dom-ready', onDomReady)
    }
  }, [nonce, safeUrl, updateTabPatch])

  return (
    <section className="tab-pane browser-tab relative">
      <div className="absolute top-0 left-0 right-0 z-30 h-9 px-2 bg-black/26 backdrop-blur-2xl shadow-[inset_0_-1px_0_0_rgba(255,255,255,0.05)]">
        <div className="absolute inset-0 [-webkit-app-region:drag]" aria-hidden="true" />
        <div className="browser-top-controls relative z-10 h-full flex items-center gap-1">
          <div className="inline-flex items-center gap-0.5 shrink-0">
            <button
              className="size-7 rounded-md border border-transparent bg-transparent text-[#d0d0d0] inline-flex items-center justify-center hover:bg-white/10 disabled:opacity-45 disabled:hover:bg-transparent transition-colors"
              onClick={() => {
                withReadyWebview((webview) => {
                  if (webview.canGoBack()) {
                    webview.goBack()
                  }
                })
              }}
              disabled={!canGoBack}
              aria-label="Back"
            >
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.9" className="size-3.5">
                <path d="M12.5 4.5 7 10l5.5 5.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button
              className="size-7 rounded-md border border-transparent bg-transparent text-[#d0d0d0] inline-flex items-center justify-center hover:bg-white/10 disabled:opacity-45 disabled:hover:bg-transparent transition-colors"
              onClick={() => {
                withReadyWebview((webview) => {
                  if (webview.canGoForward()) {
                    webview.goForward()
                  }
                })
              }}
              disabled={!canGoForward}
              aria-label="Forward"
            >
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.9" className="size-3.5">
                <path d="M7.5 4.5 13 10l-5.5 5.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button
              className="size-7 rounded-md border border-transparent bg-transparent text-[#d0d0d0] inline-flex items-center justify-center hover:bg-white/10 disabled:opacity-45 disabled:hover:bg-transparent transition-colors"
              onClick={() => {
                const reloaded = withReadyWebview((webview) => {
                  webview.reloadIgnoringCache()
                  return true
                })
                if (!reloaded) {
                  setNonce((value) => value + 1)
                }
              }}
              aria-label="Refresh"
            >
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.9" className="size-3.5">
                <path d="M15.4 10A5.4 5.4 0 1 1 14 6.2" strokeLinecap="round" />
                <path d="M15.2 3.8v2.7h-2.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          <div className="flex-1 min-w-0 flex items-center gap-2 rounded-[10px] border border-white/10 bg-black/30 px-2.5 backdrop-blur-lg focus-within:border-white/20 h-7">
            <input
              className="bg-transparent border-0 outline-none h-full px-0 rounded-none text-[12px] text-[#e5e5e5] placeholder:text-[#7f7f7f] w-full"
              value={urlInput}
              onChange={(event) => setUrlInputDraft(event.target.value)}
              onBlur={commitUrl}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  commitUrl()
                }
              }}
              placeholder="Search or enter address"
            />
          </div>

          <div className="w-[132px] shrink-0" aria-hidden="true" />
        </div>
      </div>

      <div className="browser-frame h-full pt-9">
        <webview
          className="browser-webview"
          key={`${tab.id}-${nonce}`}
          ref={(node) => {
            viewRef.current = node
            domReadyRef.current = false
          }}
          src={safeUrl}
          partition="persist:opensmith-browser"
          style={{ width: '100%', height: '100%' }}
        />
      </div>
    </section>
  )
}
