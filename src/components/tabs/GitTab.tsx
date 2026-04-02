import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  Check,
  File,
  FileEdit,
  FileMinus,
  FilePlus,
  FileQuestion,
  FolderGit2,
  GitCommit,
  Loader2,
  Maximize2,
  Minimize2,
  RefreshCw,
  X,
} from 'lucide-react'
import type { GitTabData } from '../../types/argent'

type Props = {
  tab: GitTabData
  isActive: boolean
  onChange: (next: GitTabData) => void
}

type FileStatus = {
  path: string
  x: string
  y: string
  isStaged: boolean
  isUnstaged: boolean
}

type HistoryCommit = {
  hash: string
  shortHash: string
  author: string
  authoredAt: string
  subject: string
}

type CommitFileDiff = {
  path: string
  lines: string[]
}

type ParsedCommitPreview = {
  metaLines: string[]
  statLines: string[]
  files: CommitFileDiff[]
}

function getStatusDetails(status: string) {
  switch (status) {
    case 'M':
      return { icon: FileEdit, color: 'text-[#b8b8b8]', bg: 'bg-white/10' }
    case 'A':
      return { icon: FilePlus, color: 'text-emerald-500/90', bg: 'bg-emerald-500/10' }
    case 'D':
      return { icon: FileMinus, color: 'text-rose-500/90', bg: 'bg-rose-500/10' }
    case '?':
      return { icon: FileQuestion, color: 'text-[#9c9c9c]', bg: 'bg-white/5' }
    case 'U':
      return { icon: AlertTriangle, color: 'text-[#a8a8a8]', bg: 'bg-white/5' }
    default:
      return { icon: File, color: 'text-[#888]', bg: 'bg-white/5' }
  }
}

function parseGitStatus(output: string): FileStatus[] {
  const lines = output.replace(/\n$/, '').split('\n').filter(Boolean)
  const parsed: FileStatus[] = []

  for (const line of lines) {
    if (line.length < 3) continue
    const x = line[0] as string
    const y = line[1] as string

    let path = line.substring(3).trim()
    if (path.startsWith('"') && path.endsWith('"')) {
      path = path.slice(1, -1)
    }

    const isStaged = x !== ' ' && x !== '?' && x !== 'U'
    const isUnstaged = y !== ' ' || x === '?' || x === 'U'

    parsed.push({ path, x, y, isStaged, isUnstaged })
  }

  return parsed
}

function parseBranchAheadCount(output: string) {
  const line = output.split('\n').find((entry) => entry.startsWith('# branch.ab '))
  if (!line) return 0
  const match = /^# branch\.ab \+(\d+) -(\d+)$/.exec(line.trim())
  if (!match) return 0
  return Number.parseInt(match[1] || '0', 10) || 0
}

function cleanPatchNoise(output: string) {
  return output
    .split('\n')
    .filter((line) => {
      if (line.startsWith('diff --git')) return false
      if (line.startsWith('index ')) return false
      if (line.startsWith('new file mode ')) return false
      if (line.startsWith('deleted file mode ')) return false
      if (line.startsWith('--- ')) return false
      if (line.startsWith('+++ ')) return false
      return true
    })
    .join('\n')
}

function parseHistory(output: string): HistoryCommit[] {
  const rows = output.split('\x1e').map((row) => row.trim()).filter(Boolean)

  return rows
    .map((row) => {
      const [hash, shortHash, author, authoredAt, subject] = row.split('\x1f')
      if (!hash || !shortHash) return null
      return {
        hash,
        shortHash,
        author: author || 'Unknown',
        authoredAt: authoredAt || '',
        subject: subject || '(no message)',
      }
    })
    .filter((row): row is HistoryCommit => row !== null)
}

function formatRelativeTime(iso: string) {
  if (!iso) return ''
  const timestamp = Date.parse(iso)
  if (Number.isNaN(timestamp)) return ''

  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return 'just now'

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`

  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`

  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`

  const years = Math.floor(months / 12)
  return `${years}y ago`
}

function isFullyStaged(file: FileStatus) {
  return file.isStaged && !file.isUnstaged
}

function getPatchLineClass(line: string) {
  if (line.startsWith('commit ')) return 'block px-2 py-1 font-semibold text-[#dfdfdf]'
  if (line.startsWith('Author:')) return 'block px-2 text-[#bbbbbb]'
  if (line.startsWith('Date:')) return 'block px-2 text-[#bbbbbb]'
  if (/^-+$/.test(line.trim())) return 'my-1 block px-2 text-[#666]'
  if (/^-$/.test(line.trim())) return 'block px-2 text-[#777]'
  if (line.startsWith('@@')) return 'mt-2 block bg-white/5 px-2 py-1 font-medium text-[#d0d0d0]'
  if (line.startsWith('+')) return 'block bg-emerald-500/10 px-2 text-emerald-400'
  if (line.startsWith('-')) return 'block bg-rose-500/10 px-2 text-rose-400'
  if (/^\s*\d+\s+files? changed/.test(line)) return 'mt-2 block px-2 text-[#a8a8a8]'
  if (line.includes('|')) return 'block px-2 text-[#a8a8a8]'
  return 'block px-2 text-[#cccccc]'
}

function parseDiffFilePath(line: string) {
  const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line)
  if (!match) return 'Changed file'
  const candidate = match[2] || match[1]
  if (candidate.startsWith('"') && candidate.endsWith('"')) {
    return candidate.slice(1, -1)
  }
  return candidate
}

function trimEmptyEdges(lines: string[]) {
  let start = 0
  let end = lines.length
  while (start < end && lines[start]?.trim() === '') start += 1
  while (end > start && lines[end - 1]?.trim() === '') end -= 1
  return lines.slice(start, end)
}

function parseCommitPreview(raw: string): ParsedCommitPreview {
  const lines = raw.split('\n')
  const topLines: string[] = []
  const files: CommitFileDiff[] = []
  let currentFile: CommitFileDiff | null = null
  let insideDiff = false

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      insideDiff = true
      currentFile = { path: parseDiffFilePath(line), lines: [] }
      files.push(currentFile)
      continue
    }

    if (!insideDiff) {
      topLines.push(line)
      continue
    }

    if (!currentFile) continue
    if (line.startsWith('index ')) continue
    if (line.startsWith('new file mode ')) continue
    if (line.startsWith('deleted file mode ')) continue
    if (line.startsWith('--- ')) continue
    if (line.startsWith('+++ ')) continue

    currentFile.lines.push(line)
  }

  const metaLines: string[] = []
  const statLines: string[] = []
  for (const line of trimEmptyEdges(topLines)) {
    if (/^-+$/.test(line.trim())) continue
    if (line.includes('|') || /^\s*\d+\s+files? changed/.test(line)) {
      statLines.push(line)
      continue
    }
    metaLines.push(line)
  }

  return {
    metaLines,
    statLines,
    files: files.map((file) => ({ ...file, lines: trimEmptyEdges(file.lines) })),
  }
}

export function GitTab({ tab, isActive }: Props) {
  const [checking, setChecking] = useState(true)
  const [installed, setInstalled] = useState(false)
  const [isRepo, setIsRepo] = useState(true)
  const [loading, setLoading] = useState(false)
  const [stagingPath, setStagingPath] = useState<string | null>(null)
  const [isStagingAll, setIsStagingAll] = useState(false)

  const [files, setFiles] = useState<FileStatus[]>([])
  const [commitMessage, setCommitMessage] = useState('')
  const [commitError, setCommitError] = useState<string | null>(null)

  const [selectedFile, setSelectedFile] = useState<FileStatus | null>(null)
  const [diffContent, setDiffContent] = useState<string | null>(null)

  const [history, setHistory] = useState<HistoryCommit[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [selectedCommitHash, setSelectedCommitHash] = useState<string | null>(null)
  const [commitPreview, setCommitPreview] = useState<string | null>(null)
  const [pendingPushCount, setPendingPushCount] = useState(0)

  const [remotes, setRemotes] = useState<string[]>([])
  const [addingRemote, setAddingRemote] = useState(false)
  const [newRemoteUrl, setNewRemoteUrl] = useState('')

  const [leftPanelWidth, setLeftPanelWidth] = useState(33)
  const [historyListWidth, setHistoryListWidth] = useState(36)
  const [draggingLeftSplit, setDraggingLeftSplit] = useState(false)
  const [draggingHistorySplit, setDraggingHistorySplit] = useState(false)
  const [expandedDiff, setExpandedDiff] = useState(false)
  const [expandedHistoryFile, setExpandedHistoryFile] = useState<CommitFileDiff | null>(null)

  const rootSplitRef = useRef<HTMLDivElement | null>(null)
  const historySplitRef = useRef<HTMLDivElement | null>(null)
  const selectedCommitHashRef = useRef<string | null>(null)

  useEffect(() => {
    selectedCommitHashRef.current = selectedCommitHash
  }, [selectedCommitHash])

  const hasStagedChanges = useMemo(() => files.some((file) => file.isStaged), [files])

  const orderedFiles = useMemo(() => {
    return [...files].sort((a, b) => {
      const aPinned = isFullyStaged(a) ? 1 : 0
      const bPinned = isFullyStaged(b) ? 1 : 0
      if (aPinned !== bPinned) return bPinned - aPinned
      return a.path.localeCompare(b.path)
    })
  }, [files])

  const allFullyStaged = useMemo(
    () => files.length > 0 && files.every((file) => isFullyStaged(file)),
    [files],
  )

  const someFullyStaged = useMemo(
    () => files.some((file) => isFullyStaged(file)) && !allFullyStaged,
    [files, allFullyStaged],
  )

  const parsedCommitPreview = useMemo(() => {
    if (!commitPreview) return null
    return parseCommitPreview(commitPreview)
  }, [commitPreview])

  useEffect(() => {
    if (!draggingLeftSplit) return

    function onMouseMove(event: MouseEvent) {
      if (!rootSplitRef.current) return
      const rect = rootSplitRef.current.getBoundingClientRect()
      const nextWidth = ((event.clientX - rect.left) / rect.width) * 100
      const clamped = Math.max(22, Math.min(55, nextWidth))
      setLeftPanelWidth(clamped)
    }

    function onMouseUp() {
      setDraggingLeftSplit(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)

    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [draggingLeftSplit])

  useEffect(() => {
    if (!draggingHistorySplit) return

    function onMouseMove(event: MouseEvent) {
      if (!historySplitRef.current) return
      const rect = historySplitRef.current.getBoundingClientRect()
      const nextWidth = ((event.clientX - rect.left) / rect.width) * 100
      const clamped = Math.max(22, Math.min(65, nextWidth))
      setHistoryListWidth(clamped)
    }

    function onMouseUp() {
      setDraggingHistorySplit(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)

    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [draggingHistorySplit])

  const loadHistory = useCallback(async () => {
    if (!installed) return

    setHistoryLoading(true)
    try {
      const res = await window.argent.git.exec({
        cwd: tab.cwd,
        args: ['log', '--date=iso-strict', '--pretty=format:%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1e', '-n', '80'],
      })

      if (!res.success || !res.stdout) {
        setHistory([])
        setSelectedCommitHash(null)
        setCommitPreview('No commit history yet.')
        return
      }

      const parsed = parseHistory(res.stdout)
      setHistory(parsed)

      const currentSelected = selectedCommitHashRef.current
      const keepSelection = parsed.some((commit) => commit.hash === currentSelected)
      const nextHash = keepSelection ? currentSelected : parsed[0]?.hash || null
      setSelectedCommitHash(nextHash)

      if (nextHash) {
        const showRes = await window.argent.git.exec({
          cwd: tab.cwd,
          args: [
            'show',
            '--stat',
            '--patch',
            '--decorate=short',
            '--date=relative',
            '--pretty=format:commit %h%nAuthor: %an%nDate:   %ad%n%n%s%n',
            nextHash,
          ],
        })
        if (showRes.success) {
          setCommitPreview(showRes.stdout || 'No details')
        } else {
          setCommitPreview(showRes.stderr || showRes.error || 'Failed to load commit details')
        }
      } else {
        setCommitPreview('No commit history yet.')
      }
    } catch {
      setHistory([])
      setCommitPreview('Failed to load commit history')
    } finally {
      setHistoryLoading(false)
    }
  }, [installed, tab.cwd])

  const loadPendingPush = useCallback(async () => {
    if (!installed) return

    const res = await window.argent.git.exec({
      cwd: tab.cwd,
      args: ['status', '--porcelain=2', '--branch'],
    })

    if (!res.success || !res.stdout) {
      setPendingPushCount(0)
      return
    }

    setPendingPushCount(parseBranchAheadCount(res.stdout))
  }, [installed, tab.cwd])

  const loadRemotes = useCallback(async () => {
    if (!installed) return
    const res = await window.argent.git.exec({
      cwd: tab.cwd,
      args: ['remote'],
    })
    if (res.success && res.stdout) {
      setRemotes(res.stdout.split('\n').map(s => s.trim()).filter(Boolean))
    } else {
      setRemotes([])
    }
  }, [installed, tab.cwd])

  const refreshStatus = useCallback(async (options?: { includeHistory?: boolean; includePendingPush?: boolean }) => {
    const includeHistory = options?.includeHistory ?? true
    const includePendingPush = options?.includePendingPush ?? true

    if (!installed) return

    setLoading(true)
    try {
      let isActuallyRepo = false
      let revRes = await window.argent.git.exec({
        cwd: tab.cwd,
        args: ['rev-parse', '--is-inside-work-tree']
      })
      
      if (!revRes.success && (revRes.stderr?.includes('dubious ownership') || revRes.error?.includes('dubious ownership'))) {
        await window.argent.git.exec({ cwd: tab.cwd, args: ['config', '--global', '--add', 'safe.directory', '*'] })
        revRes = await window.argent.git.exec({
          cwd: tab.cwd,
          args: ['rev-parse', '--is-inside-work-tree']
        })
      }

      isActuallyRepo = revRes.success && revRes.stdout?.trim() === 'true'
      setIsRepo(isActuallyRepo)
      if (!isActuallyRepo) {
        setFiles([])
        setHistory([])
        setSelectedCommitHash(null)
        setCommitPreview(null)
        setPendingPushCount(0)
        setRemotes([])
        return
      }

      const res = await window.argent.git.exec({
        cwd: tab.cwd,
        args: ['status', '-s', '-uall'],
      })

      if (res.success && res.stdout !== undefined) {
        setFiles(parseGitStatus(res.stdout))
      }

      const followUps: Array<Promise<void>> = [loadRemotes()]
      if (includeHistory) {
        followUps.push(loadHistory())
      }
      if (includePendingPush) {
        followUps.push(loadPendingPush())
      }
      if (followUps.length > 0) {
        await Promise.all(followUps)
      }
    } catch (error) {
      console.error('Failed to refresh git status', error)
    } finally {
      setLoading(false)
    }
  }, [installed, loadHistory, loadPendingPush, loadRemotes, tab.cwd])

  useEffect(() => {
    async function checkGit() {
      try {
        const out = await window.argent.git.checkInstalled()
        setInstalled(out.installed)

        if (out.installed) {
          let isActuallyRepo = false
          let revRes = await window.argent.git.exec({
            cwd: tab.cwd,
            args: ['rev-parse', '--is-inside-work-tree']
          })

          if (!revRes.success && (revRes.stderr?.includes('dubious ownership') || revRes.error?.includes('dubious ownership'))) {
            await window.argent.git.exec({ cwd: tab.cwd, args: ['config', '--global', '--add', 'safe.directory', '*'] })
            revRes = await window.argent.git.exec({
              cwd: tab.cwd,
              args: ['rev-parse', '--is-inside-work-tree']
            })
          }

          isActuallyRepo = revRes.success && revRes.stdout?.trim() === 'true'
          setIsRepo(isActuallyRepo)

          if (isActuallyRepo) {
            const res = await window.argent.git.exec({
              cwd: tab.cwd,
              args: ['status', '-s', '-uall'],
            })

            if (res.success && res.stdout !== undefined) {
              setFiles(parseGitStatus(res.stdout))
            }

            await Promise.all([loadHistory(), loadPendingPush(), loadRemotes()])
          }
        }
      } catch {
        setInstalled(false)
      } finally {
        setChecking(false)
      }
    }

    void checkGit()
  }, [loadHistory, loadPendingPush, loadRemotes, tab.cwd])

  useEffect(() => {
    if (isActive && installed && !checking) {
      void refreshStatus()
    }
  }, [checking, installed, isActive, refreshStatus])

  async function initRepo() {
    setLoading(true)
    try {
      await window.argent.git.exec({ cwd: tab.cwd, args: ['config', '--global', '--add', 'safe.directory', '*'] })
      await window.argent.git.exec({ cwd: tab.cwd, args: ['init'] })
      await refreshStatus()
    } finally {
      setLoading(false)
    }
  }

  async function stageFile(path: string) {
    if (loading || isStagingAll || stagingPath) return
    setStagingPath(path)
    await window.argent.git.exec({ cwd: tab.cwd, args: ['add', '-A', '--', path] })
    await refreshStatus({ includeHistory: false, includePendingPush: false })

    if (selectedFile?.path === path) {
      await viewDiff({ ...selectedFile, isStaged: true, isUnstaged: false })
    }
    setStagingPath(null)
  }

  async function unstageFile(path: string) {
    if (loading || isStagingAll || stagingPath) return
    setStagingPath(path)
    const res = await window.argent.git.exec({ cwd: tab.cwd, args: ['reset', 'HEAD', path] })
    if (!res.success && (res.stderr?.includes("ambiguous argument 'HEAD'") || res.error?.includes("ambiguous argument 'HEAD'"))) {
      await window.argent.git.exec({ cwd: tab.cwd, args: ['rm', '--cached', path] })
    }
    await refreshStatus({ includeHistory: false, includePendingPush: false })

    if (selectedFile?.path === path) {
      await viewDiff({ ...selectedFile, isStaged: false, isUnstaged: true })
    }
    setStagingPath(null)
  }

  async function toggleStageAll() {
    if (loading || isStagingAll || stagingPath) return
    setIsStagingAll(true)
    if (allFullyStaged) {
      let res = await window.argent.git.exec({ cwd: tab.cwd, args: ['reset', 'HEAD'] })
      if (!res.success && (res.stderr?.includes("ambiguous argument 'HEAD'") || res.error?.includes("ambiguous argument 'HEAD'"))) {
        res = await window.argent.git.exec({ cwd: tab.cwd, args: ['rm', '-r', '--cached', '.'] })
      }
      if (!res.success) {
        setCommitError(res.stderr || res.error || 'Failed to unstage all changes')
        setIsStagingAll(false)
        return
      }
    } else {
      const skippedPaths: string[] = []
      const failedPaths: string[] = []

      for (const file of files) {
        if (file.path.endsWith('/')) {
          skippedPaths.push(file.path)
          continue
        }

        const res = await window.argent.git.exec({ cwd: tab.cwd, args: ['add', '-A', '--', file.path] })
        if (!res.success) {
          failedPaths.push(file.path)
        }
      }

      if (failedPaths.length > 0) {
        const sample = failedPaths.slice(0, 2).join(', ')
        setCommitError(
          failedPaths.length > 2
            ? `Failed to stage ${failedPaths.length} files (e.g. ${sample})`
            : `Failed to stage: ${sample}`,
        )
      } else if (skippedPaths.length > 0) {
        setCommitError(
          skippedPaths.length > 2
            ? `Skipped ${skippedPaths.length} directory entries during stage-all`
            : `Skipped: ${skippedPaths.join(', ')}`,
        )
      } else {
        setCommitError(null)
      }
    }
    await refreshStatus({ includeHistory: false, includePendingPush: false })
    setIsStagingAll(false)
  }

  async function viewDiff(file: FileStatus) {
    setSelectedFile(file)
    setDiffContent('Loading diff...')

    if (file.x === '?' && file.y === '?') {
      const res = await window.argent.git.exec({
        cwd: tab.cwd,
        args: ['diff', '--no-index', '/dev/null', file.path],
      })
      setDiffContent(cleanPatchNoise(res.stdout || 'Untracked empty file'))
      return
    }

    const args = ['diff', 'HEAD', '--', file.path]

    let res = await window.argent.git.exec({ cwd: tab.cwd, args })
    if (!res.success && (res.stderr?.includes("ambiguous argument 'HEAD'") || res.error?.includes("ambiguous argument 'HEAD'"))) {
      res = await window.argent.git.exec({ cwd: tab.cwd, args: ['diff', '--no-index', '/dev/null', file.path] })
    }
    setDiffContent(cleanPatchNoise(res.stdout || 'No differences'))
  }

  async function selectCommit(hash: string) {
    setSelectedCommitHash(hash)
    setCommitPreview('Loading commit...')

    const res = await window.argent.git.exec({
      cwd: tab.cwd,
      args: [
        'show',
        '--stat',
        '--patch',
        '--decorate=short',
        '--date=relative',
        '--pretty=format:commit %h%nAuthor: %an%nDate:   %ad%n%n%s%n',
        hash,
      ],
    })

    if (res.success) {
      setCommitPreview(res.stdout || 'No details')
      return
    }

    setCommitPreview(res.stderr || res.error || 'Failed to load commit details')
  }

  async function handleAddRemote() {
    if (!newRemoteUrl.trim()) {
      setAddingRemote(false)
      return
    }
    setLoading(true)
    const res = await window.argent.git.exec({
      cwd: tab.cwd,
      args: ['remote', 'add', 'origin', newRemoteUrl.trim()],
    })
    
    if (res.success && history.length > 0) {
      const branchRes = await window.argent.git.exec({ cwd: tab.cwd, args: ['branch', '--show-current'] })
      const branch = branchRes.success && branchRes.stdout ? branchRes.stdout.trim() : 'main'
      if (branch) {
        await window.argent.git.exec({ cwd: tab.cwd, args: ['push', '-u', 'origin', branch] })
      }
    } else if (!res.success) {
      setCommitError(res.stderr || res.error || 'Failed to add remote')
    }
    
    setAddingRemote(false)
    setNewRemoteUrl('')
    await refreshStatus()
  }

  async function handleCommit() {
    if (!commitMessage.trim()) return

    setCommitError(null)
    setLoading(true)

    const res = await window.argent.git.exec({
      cwd: tab.cwd,
      args: ['commit', '-m', commitMessage.trim()],
    })

    if (res.success) {
      setCommitMessage('')
      await refreshStatus()
      return
    }

    setCommitError(res.stderr || res.error || 'Failed to commit changes')
    setLoading(false)
  }

  async function handleSync() {
    setCommitError(null)
    setLoading(true)

    await window.argent.git.exec({ cwd: tab.cwd, args: ['pull'] })
    let pushRes = await window.argent.git.exec({ cwd: tab.cwd, args: ['push'] })

    if (!pushRes.success && (pushRes.stderr?.includes('has no upstream branch') || pushRes.error?.includes('has no upstream branch') || pushRes.stderr?.includes('setup upstream tracking'))) {
      const branchRes = await window.argent.git.exec({ cwd: tab.cwd, args: ['branch', '--show-current'] })
      const branch = branchRes.success && branchRes.stdout ? branchRes.stdout.trim() : 'main'
      if (branch) {
        pushRes = await window.argent.git.exec({ cwd: tab.cwd, args: ['push', '-u', 'origin', branch] })
      }
    }

    if (pushRes.success) {
      await refreshStatus()
      return
    }

    setCommitError(pushRes.stderr || pushRes.error || 'Failed to sync changes')
    setLoading(false)
  }

  function renderDiffContent() {
    return (
      <>
        <div className="flex shrink-0 items-center justify-between border-b border-white/5 bg-black/20 p-2">
          <span className="truncate px-2 font-mono text-[11px] text-[#d4d4d4]">{selectedFile?.path || 'Diff'}</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setExpandedDiff((current) => !current)}
              className="cursor-pointer rounded p-1 text-[#888] hover:bg-white/10 hover:text-white"
              title={expandedDiff ? 'Restore view' : 'Expand diff viewer'}
            >
              {expandedDiff ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
            <button
              onClick={() => setSelectedFile(null)}
              className="cursor-pointer rounded p-1 text-[#888] hover:bg-white/10 hover:text-white"
              title="Close diff"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="custom-scrollbar flex-1 overflow-auto bg-[#0f0f0f] p-4">
          <div className="custom-scrollbar overflow-x-auto">
            <pre className="inline-block min-w-full whitespace-pre font-mono text-[12px] leading-[18px]">
              {(diffContent || 'No differences').split('\n').map((line, index) => (
                <span key={index} className={`${getPatchLineClass(line)} w-full whitespace-pre`}>
                  {line || ' '}
                </span>
              ))}
            </pre>
          </div>
        </div>
      </>
    )
  }

  function renderHistoryContent() {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div ref={historySplitRef} className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <div
            className="custom-scrollbar h-[40%] min-h-[180px] overflow-y-auto border-b border-white/5 lg:h-auto lg:border-r lg:border-b-0"
            style={{ width: `min(560px, ${historyListWidth}%)` }}
          >
            {historyLoading ? (
              <div className="flex items-center gap-2 px-3 py-3 text-xs text-[#888]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading commits...
              </div>
            ) : history.length === 0 ? (
              <div className="px-3 py-3 text-xs italic text-[#666]">No commit history yet</div>
            ) : (
              history.map((commit) => (
                <button
                  key={commit.hash}
                  onClick={() => void selectCommit(commit.hash)}
                  className={`block w-full border-b border-white/5 px-3 py-2.5 text-left transition-colors ${
                    selectedCommitHash === commit.hash
                      ? 'border-l-2 border-l-white/40 bg-white/10 text-white'
                      : 'text-[#bdbdbd] hover:bg-white/5 hover:text-[#e0e0e0]'
                  }`}
                >
                  <div className="truncate text-[12px] font-semibold leading-tight">{commit.subject}</div>
                  <div className="mt-1 flex items-center justify-between text-[10px] text-[#888]">
                    <span className="rounded border border-white/10 bg-white/5 px-1.5 py-[1px] font-mono text-[10px] text-[#d0d0d0]">
                      {commit.shortHash}
                    </span>
                    <span>{formatRelativeTime(commit.authoredAt)}</span>
                  </div>
                  <div className="mt-0.5 truncate text-[10px] text-[#777]">{commit.author}</div>
                </button>
              ))
            )}
          </div>

          <div
            role="separator"
            aria-orientation="vertical"
            className="group relative hidden w-1 shrink-0 cursor-col-resize bg-white/[0.03] transition-colors hover:bg-white/10 lg:block"
            onMouseDown={() => setDraggingHistorySplit(true)}
            title="Drag to resize history"
          >
            <div className="absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 rounded-full bg-white/20 opacity-0 transition-opacity group-hover:opacity-100" />
          </div>

          <div className="custom-scrollbar flex-1 overflow-auto bg-white/[0.01] p-3">
            {!parsedCommitPreview || parsedCommitPreview.files.length === 0 ? (
              <div className="custom-scrollbar overflow-x-auto">
                <pre className="inline-block min-w-full whitespace-pre font-mono text-[12px] leading-[18px] text-[#cccccc]">
                {(commitPreview || 'Select a commit to inspect its patch').split('\n').map((line, index) => (
                  <span key={index} className={`${getPatchLineClass(line)} w-full whitespace-pre`}>
                    {line || ' '}
                  </span>
                ))}
                </pre>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="pb-2 border-b border-white/10">
                  <div className="custom-scrollbar overflow-x-auto">
                    <pre className="inline-block min-w-full whitespace-pre p-2 font-mono text-[12px] leading-[18px] text-[#cccccc]">
                    {parsedCommitPreview.metaLines.map((line, index) => (
                      <span key={`meta-${index}`} className={`${getPatchLineClass(line)} w-full whitespace-pre`}>
                        {line || ' '}
                      </span>
                    ))}
                    {parsedCommitPreview.statLines.length > 0 ? (
                      <>
                        <span className="my-2 block border-t border-white/10" />
                        {parsedCommitPreview.statLines.map((line, index) => (
                          <span key={`stat-${index}`} className={`${getPatchLineClass(line)} w-full whitespace-pre`}>
                            {line}
                          </span>
                        ))}
                      </>
                    ) : null}
                    </pre>
                  </div>
                </div>

                {parsedCommitPreview.files.map((file, fileIndex) => (
                  <div key={`${file.path}-${fileIndex}`} className="py-2 border-b border-white/8 last:border-b-0">
                    <div className="flex items-center justify-between px-2 py-1.5">
                      <span className="truncate pr-3 font-mono text-[11px] text-[#d0d0d0]">{file.path}</span>
                      <button
                        onClick={() => setExpandedHistoryFile(file)}
                        className="cursor-pointer rounded p-1 text-[#888] hover:bg-white/10 hover:text-white"
                        title="Expand this file"
                      >
                        <Maximize2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="custom-scrollbar overflow-x-auto">
                      <pre className="inline-block min-w-full whitespace-pre p-2 font-mono text-[12px] leading-[18px]">
                      {file.lines.length === 0 ? (
                        <span className="block px-2 text-[#888]">No patch content</span>
                      ) : (
                        file.lines.map((line, lineIndex) => (
                          <span key={`${file.path}-${lineIndex}`} className={`${getPatchLineClass(line)} w-full whitespace-pre`}>
                            {line || ' '}
                          </span>
                        ))
                      )}
                      </pre>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  if (checking) {
    return (
      <div className="tab-pane flex items-center justify-center p-6 text-[#bebebe]">
        <Loader2 className="mr-3 h-6 w-6 animate-spin" />
        <span>Checking Git installation...</span>
      </div>
    )
  }

  if (!installed) {
    return (
      <div className="tab-pane flex flex-col items-center justify-center p-8 text-center text-[#bebebe]">
        <AlertTriangle className="mb-4 h-12 w-12 text-[#b0b0b0]/80" />
        <h2 className="mb-2 text-xl font-medium text-white">Git CLI not installed</h2>
        <p className="max-w-md text-[#888]">
          Argent requires the Git command line tools to manage source control.
          Please install Git and restart the application.
        </p>
      </div>
    )
  }

  if (!isRepo) {
    return (
      <div className="tab-pane flex flex-col items-center justify-center p-8 text-center text-[#bebebe]">
        <FolderGit2 className="mb-4 h-12 w-12 text-[#b0b0b0]/80" />
        <h2 className="mb-2 text-xl font-medium text-white">No Git Repository</h2>
        <p className="mb-6 max-w-md text-[#888]">
          The current workspace is not a Git repository. Initialize one to start tracking changes.
        </p>
        <button onClick={initRepo} disabled={loading} className="primary-btn px-4 py-2">
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FolderGit2 className="mr-2 h-4 w-4" />}
          Initialize Repository
        </button>
      </div>
    )
  }

  const hasMessage = commitMessage.trim().length > 0

  return (
    <div className="tab-pane git-tab relative flex h-full flex-col overflow-hidden bg-transparent text-sm text-[#bebebe]">
      <div ref={rootSplitRef} className="flex h-full flex-1 flex-col overflow-hidden md:flex-row">
        <div
          className="flex h-full w-full flex-col border-r border-white/10 p-3 md:w-auto"
          style={{ flexBasis: `${leftPanelWidth}%` }}
        >
          <div className="custom-scrollbar flex-1 space-y-[1px] overflow-y-auto pr-1">
            {orderedFiles.length === 0 ? (
              <div className="px-1 text-xs italic text-[#555]">No changes</div>
            ) : (
              orderedFiles.map((file) => {
                const fullyStaged = isFullyStaged(file)
                const status = getStatusDetails(file.y === ' ' || file.y === '?' ? file.x : file.y)
                const Icon = status.icon

                return (
                  <div
                    key={`file-${file.path}`}
                    onClick={() => void viewDiff(file)}
                    className={`group flex cursor-pointer items-center rounded-md px-1 py-1 text-[13px] ${
                      selectedFile?.path === file.path
                        ? 'bg-white/10 text-white'
                        : 'text-[#bebebe] hover:bg-white/5 hover:text-[#d7d7d7]'
                    }`}
                  >
                    <button
                      disabled={stagingPath === file.path || isStagingAll}
                      className={`mr-2 ml-[1px] flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] transition-colors disabled:opacity-50 disabled:cursor-wait ${
                        fullyStaged ? 'bg-white text-black' : 'border border-[#666] hover:border-[#aaa]'
                      }`}
                      onClick={(event) => {
                        event.stopPropagation()
                        if (fullyStaged) {
                          void unstageFile(file.path)
                        } else {
                          void stageFile(file.path)
                        }
                      }}
                    >
                      {stagingPath === file.path ? <Loader2 className="h-2.5 w-2.5 animate-spin text-[#888]" /> : (
                        <>
                          {fullyStaged ? <Check className="h-2.5 w-2.5" strokeWidth={3} /> : null}
                          {!fullyStaged && file.isStaged ? <div className="h-1.5 w-1.5 rounded-sm bg-[#888]" /> : null}
                        </>
                      )}
                    </button>

                    <div className="flex min-w-0 flex-1 items-center gap-1.5 pr-2">
                      <span
                        className={`inline-flex h-[16px] w-[16px] items-center justify-center rounded-[4px] ${status.bg} ${status.color}`}
                        title={file.y === ' ' ? file.x : file.y}
                      >
                        <Icon className="h-[10px] w-[10px]" strokeWidth={2.5} />
                      </span>
                      <span className="truncate text-[12.5px]">{file.path}</span>
                    </div>
                  </div>
                )
              })
            )}
          </div>

          <div className="mt-2 shrink-0">
            <div className="mb-2 flex items-center justify-between px-1 py-1 text-[11px]">
              <div className="flex items-center gap-2 font-medium uppercase text-[#888]">
                <button
                  disabled={isStagingAll || stagingPath !== null}
                  className={`flex h-3.5 w-3.5 items-center justify-center rounded-[3px] transition-colors disabled:opacity-50 disabled:cursor-wait ${
                    allFullyStaged ? 'border border-white bg-white text-black' : 'border border-[#666] hover:border-[#aaa]'
                  }`}
                  onClick={() => void toggleStageAll()}
                  title={allFullyStaged ? 'Unstage All Changes' : 'Stage All Changes'}
                >
                  {isStagingAll ? <Loader2 className="h-2.5 w-2.5 animate-spin text-[#888]" /> : (
                    <>
                      {allFullyStaged ? <Check className="h-2.5 w-2.5" strokeWidth={3} /> : null}
                      {!allFullyStaged && someFullyStaged ? <div className="h-1.5 w-1.5 rounded-sm bg-[#888]" /> : null}
                    </>
                  )}
                </button>
                <span>CHANGES</span>
                <span className="normal-case text-[#777]">{files.length} changed file{files.length === 1 ? '' : 's'}</span>
                {pendingPushCount > 0 ? (
                  <span className="normal-case rounded bg-white/12 px-1.5 py-[1px] text-[#f2f2f2]">
                    {pendingPushCount} to push
                  </span>
                ) : null}
              </div>

              <button
                onClick={() => void refreshStatus()}
                className="ghost-btn rounded-md p-1 text-[#7b7b7b] hover:text-[#d0d0d0]"
                title="Refresh"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading || historyLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>

            <div className="space-y-2 border-t border-white/10 pt-3">
            {remotes.length === 0 ? (
              <div className="mb-2 flex items-center justify-between rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-[11px]">
                {addingRemote ? (
                  <div className="flex w-full gap-1">
                    <input 
                      autoFocus
                      placeholder="https://github.com/user/repo.git..." 
                      className="flex-1 bg-transparent text-[#e0e0e0] outline-none placeholder:text-[#666]" 
                      value={newRemoteUrl}
                      onChange={e => setNewRemoteUrl(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') void handleAddRemote()
                        if (e.key === 'Escape') setAddingRemote(false)
                      }}
                    />
                    <button onClick={() => setAddingRemote(false)} className="text-[#888] hover:text-white"><X className="h-3 w-3" /></button>
                  </div>
                ) : (
                  <>
                    <span className="text-[#999]">No remote repository</span>
                    <button onClick={() => setAddingRemote(true)} className="text-white hover:text-[#d0d0d0] underline decoration-white/30 underline-offset-2">Publish (Add Origin)</button>
                  </>
                )}
              </div>
            ) : null}
            <textarea
              value={commitMessage}
              onChange={(event) => setCommitMessage(event.target.value)}
              className="custom-scrollbar h-[64px] w-full resize-none rounded-md border border-white/10 bg-black/20 p-2 text-xs text-[#d8d8d8] focus:border-white/20 focus:outline-none"
              placeholder="Message (Ctrl+Enter to commit)"
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault()
                  void handleCommit()
                }
              }}
            />

            <div className="flex items-center justify-between gap-1.5">
              {hasMessage ? (
                <>
                  <button
                    onClick={() => void handleCommit()}
                    disabled={loading || !hasStagedChanges}
                    className="primary-btn flex h-8 flex-1 items-center justify-center gap-1.5 border border-transparent text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <GitCommit className="h-3.5 w-3.5" />
                    Commit
                  </button>
                  <button
                    onClick={() => void handleSync()}
                    disabled={loading}
                    className={`ghost-btn flex h-8 w-8 shrink-0 items-center justify-center rounded-lg disabled:cursor-not-allowed disabled:opacity-50 ${
                      pendingPushCount > 0
                        ? 'bg-[#f1f1f1] text-[#121212] hover:bg-white'
                        : 'bg-transparent text-[#7b7b7b] hover:bg-white/8 hover:text-[#d0d0d0]'
                    }`}
                    title="Sync (Pull + Push)"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => void handleSync()}
                    disabled={loading}
                    className={`primary-btn flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50 ${
                      pendingPushCount > 0
                        ? ''
                        : '!bg-white/6 !text-[#d8d8d8] hover:!bg-white/10'
                    }`}
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                    Sync Changes
                  </button>
                  <button
                    disabled
                    className="flex h-8 w-8 shrink-0 cursor-not-allowed items-center justify-center rounded-lg bg-black/20 text-[#555] opacity-50"
                    title="Enter a message to commit"
                  >
                    <GitCommit className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
            </div>

            {commitError ? (
              <div className="mt-2 flex items-start rounded border border-red-500/20 bg-red-500/10 p-2 text-[11px] leading-relaxed text-red-400">
                <AlertCircle className="mt-[2px] mr-2 h-3 w-3 shrink-0" />
                <span className="line-clamp-3 break-words">{commitError}</span>
              </div>
            ) : null}
            </div>
          </div>
        </div>

        <div
          role="separator"
          aria-orientation="vertical"
          className="group relative hidden w-1 cursor-col-resize bg-white/[0.03] transition-colors hover:bg-white/10 md:block"
          onMouseDown={() => setDraggingLeftSplit(true)}
          title="Drag to resize panels"
        >
          <div className="absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 rounded-full bg-white/20 opacity-0 transition-opacity group-hover:opacity-100" />
        </div>

        <div className="flex h-full w-full min-w-0 flex-1 flex-col overflow-hidden bg-white/[0.02]">
          {selectedFile ? renderDiffContent() : renderHistoryContent()}
        </div>
      </div>

      {expandedDiff || expandedHistoryFile ? (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 p-3 md:p-6">
          <div className="flex h-full w-full max-w-[1700px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#101010]/95 shadow-2xl backdrop-blur-xl">
            <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.03] px-3 py-2">
              <div className="text-xs font-medium uppercase tracking-wide text-[#8f8f8f]">
                {expandedHistoryFile ? `Expanded File Diff - ${expandedHistoryFile.path}` : 'Expanded Diff Viewer'}
              </div>
              <button
                onClick={() => {
                  setExpandedDiff(false)
                  setExpandedHistoryFile(null)
                }}
                className="cursor-pointer rounded p-1 text-[#888] hover:bg-white/10 hover:text-white"
                title="Close expanded view"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
                {expandedHistoryFile ? (
                  <div className="flex h-full min-h-0 flex-col">
                    <div className="shrink-0 border-b border-white/10 bg-white/[0.03] px-4 py-2.5">
                      <span className="block truncate font-mono text-[11px] text-[#d0d0d0]">{expandedHistoryFile.path}</span>
                    </div>
                    <div className="custom-scrollbar flex-1 overflow-auto bg-white/[0.02] p-4">
                      <div className="custom-scrollbar overflow-x-auto">
                        <pre className="inline-block min-w-full whitespace-pre font-mono text-[12px] leading-[18px]">
                        {expandedHistoryFile.lines.length === 0 ? (
                          <span className="block px-2 text-[#888]">No patch content</span>
                        ) : (
                          expandedHistoryFile.lines.map((line, index) => (
                            <span key={`${expandedHistoryFile.path}-${index}`} className={`${getPatchLineClass(line)} w-full whitespace-pre`}>
                              {line || ' '}
                            </span>
                          ))
                        )}
                        </pre>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full min-h-0 flex-col">
                    <div className="flex shrink-0 items-center justify-between border-b border-white/10 bg-white/[0.03] px-4 py-2.5">
                      <span className="truncate pr-3 font-mono text-[11px] text-[#d4d4d4]">{selectedFile?.path || 'Diff'}</span>
                    </div>
                    <div className="custom-scrollbar flex-1 overflow-auto bg-white/[0.02] p-4">
                      <div className="custom-scrollbar overflow-x-auto">
                        <pre className="inline-block min-w-full whitespace-pre font-mono text-[12px] leading-[18px]">
                          {(diffContent || 'No differences').split('\n').map((line, index) => (
                            <span key={index} className={`${getPatchLineClass(line)} w-full whitespace-pre`}>
                              {line || ' '}
                            </span>
                          ))}
                        </pre>
                      </div>
                    </div>
                  </div>
                )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
