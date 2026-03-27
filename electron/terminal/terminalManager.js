import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import { spawn as spawnPty } from 'node-pty'

function getWindowsBuildNumber() {
  if (process.platform !== 'win32') {
    return null
  }

  const rawBuild = os.release().split('.').at(-1) || ''
  const parsedBuild = Number.parseInt(rawBuild, 10)
  return Number.isFinite(parsedBuild) ? parsedBuild : null
}

function shouldUseWinpty() {
  const buildNumber = getWindowsBuildNumber()
  return process.platform === 'win32' && (buildNumber === null || buildNumber < 22000)
}

function getShell() {
  if (process.platform === 'win32') {
    return {
      command: 'powershell.exe',
      args: ['-NoLogo'],
    }
  }

  return {
    command: process.env.SHELL || '/bin/bash',
    args: [],
  }
}

export class TerminalManager {
  constructor(sendToRenderer) {
    this.sendToRenderer = sendToRenderer
    this.sessions = new Map()
  }

  createSession(cwd) {
    const id = randomUUID()
    const shell = getShell()
    const resolvedCwd = cwd && fs.existsSync(cwd) ? cwd : process.cwd()

    const terminal = spawnPty(shell.command, shell.args, {
      name: process.platform === 'win32' ? 'xterm' : 'xterm-256color',
      cols: 120,
      rows: 32,
      cwd: resolvedCwd,
      env: process.env,
      handleFlowControl: false,
      useConpty: process.platform === 'win32' ? !shouldUseWinpty() : undefined,
    })

    terminal.onData((data) => {
      this.sendToRenderer('terminal:data', { id, data })
    })

    terminal.onExit((event) => {
      this.sendToRenderer('terminal:exit', { id, code: event.exitCode })
      this.sessions.delete(id)
    })

    this.sessions.set(id, terminal)
    return { id }
  }

  write(id, data) {
    const session = this.sessions.get(id)
    if (!session) {
      return false
    }

    session.write(data)
    return true
  }

  resize(id, cols, rows) {
    const session = this.sessions.get(id)
    if (!session) {
      return false
    }

    const nextCols = Number.isFinite(cols) && cols > 0 ? Math.floor(cols) : 120
    const nextRows = Number.isFinite(rows) && rows > 0 ? Math.floor(rows) : 32
    session.resize(nextCols, nextRows)
    return true
  }

  kill(id) {
    const session = this.sessions.get(id)
    if (!session) {
      return false
    }

    session.kill()
    this.sessions.delete(id)
    return true
  }

  disposeAll() {
    for (const id of Array.from(this.sessions.keys())) {
      try {
        this.kill(id)
      } catch {
        this.sessions.delete(id)
      }
    }
  }
}
