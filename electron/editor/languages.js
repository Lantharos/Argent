import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export const languageServers = {
  typescript: {
    type: 'stdio',
    commands: [
      { runtime: 'node', script: 'node_modules/typescript-language-server/lib/cli.mjs', args: ['--stdio'] },
      { command: 'typescript-language-server', args: ['--stdio'] },
    ],
    installHint: 'Install typescript-language-server to enable project-aware TypeScript IntelliSense.',
    install: {
      kind: 'package-manager',
      packages: ['typescript-language-server', 'typescript'],
      label: 'Install TypeScript LSP',
    },
  },
  javascript: {
    type: 'stdio',
    commands: [
      { runtime: 'node', script: 'node_modules/typescript-language-server/lib/cli.mjs', args: ['--stdio'] },
      { command: 'typescript-language-server', args: ['--stdio'] },
    ],
    installHint: 'Install typescript-language-server to enable project-aware JavaScript IntelliSense.',
    install: {
      kind: 'package-manager',
      packages: ['typescript-language-server', 'typescript'],
      label: 'Install JavaScript LSP',
    },
  },
  python: {
    type: 'stdio',
    commands: [{ command: 'pyright-langserver', args: ['--stdio'] }],
    installHint: 'Install Pyright locally or globally to enable Python IntelliSense.',
    install: {
      kind: 'package-manager',
      packages: ['pyright'],
      label: 'Install Pyright',
    },
  },
  go: {
    type: 'stdio',
    commands: [{ command: 'gopls', args: [] }],
    installHint: 'Install gopls to enable Go IntelliSense.',
  },
  rust: {
    type: 'stdio',
    commands: [{ command: 'rust-analyzer', args: [] }],
    installHint: 'Install rust-analyzer to enable Rust IntelliSense.',
  },
  cpp: {
    type: 'stdio',
    commands: [{ command: 'clangd', args: [] }],
    installHint: 'Install clangd to enable C and C++ IntelliSense.',
  },
  c: {
    type: 'stdio',
    commands: [{ command: 'clangd', args: [] }],
    installHint: 'Install clangd to enable C and C++ IntelliSense.',
  },
  gdscript: {
    type: 'tcp',
    host: '127.0.0.1',
    port: 6005,
    installHint: 'Open this Godot project in the Godot editor to expose the built-in GDScript language server on port 6005.',
    requiresGodotProject: true,
  },
  svelte: {
    type: 'stdio',
    commands: [
      { runtime: 'node', script: 'node_modules/svelte-language-server/bin/server.js', args: ['--stdio'] },
      { command: 'svelteserver', args: ['--stdio'] },
      { command: 'svelte-language-server', args: ['--stdio'] },
    ],
    installHint: 'Install svelte-language-server to enable Svelte IntelliSense.',
    install: {
      kind: 'package-manager',
      packages: ['svelte-language-server'],
      label: 'Install Svelte LSP',
    },
  },
}

export function isGodotProject(workspacePath) {
  return fs.existsSync(path.join(workspacePath, 'project.godot'))
}

export async function resolveExecutable(command, workspacePath) {
  const localBins = []
  if (workspacePath) {
    const base = path.join(workspacePath, 'node_modules', '.bin')
    if (process.platform === 'win32') {
      localBins.push(path.join(base, `${command}.cmd`))
      localBins.push(path.join(base, `${command}.exe`))
    }
    localBins.push(path.join(base, command))
  }

  for (const candidate of localBins) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }

  const whereCommand = process.platform === 'win32' ? 'where.exe' : 'which'
  try {
    const { stdout } = await execFileAsync(whereCommand, [command], { windowsHide: true })
    const match = stdout.split(/\r?\n/).find(Boolean)
    return match ?? null
  } catch {
    return null
  }
}

export async function resolveCommandSpec(spec, workspacePath) {
  if (spec.runtime === 'node' && spec.script) {
    const nodeExecutable = await resolveExecutable('node', workspacePath)
    if (!nodeExecutable) {
      return null
    }

    const scriptPath = path.isAbsolute(spec.script)
      ? spec.script
      : path.join(workspacePath, spec.script)

    if (!fs.existsSync(scriptPath)) {
      return null
    }

    return {
      executable: nodeExecutable,
      args: [scriptPath, ...(spec.args ?? [])],
    }
  }

  if (!spec.command) {
    return null
  }

  const executable = await resolveExecutable(spec.command, workspacePath)
  if (!executable) {
    return null
  }

  return {
    executable,
    args: spec.args ?? [],
  }
}

export async function detectGodotExecutable() {
  const directHints = [
    process.env.GODOT_EXECUTABLE,
    path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Godot', 'Godot.exe'),
    path.join(os.homedir(), 'AppData', 'Local', 'Godot', 'Godot.exe'),
    'C:\\Program Files\\Godot\\Godot.exe',
    'C:\\Program Files\\Godot_v4\\Godot.exe',
  ].filter(Boolean)

  for (const hint of directHints) {
    if (hint && fs.existsSync(hint)) {
      return hint
    }
  }

  const candidates = process.platform === 'win32'
    ? ['godot4', 'godot', 'Godot_v4', 'Godot_v4.0-stable_win64']
    : ['godot4', 'godot']

  for (const candidate of candidates) {
    const resolved = await resolveExecutable(candidate)
    if (resolved) {
      return resolved
    }
  }

  return process.env.GODOT_EXECUTABLE ?? null
}

export async function detectPackageManager(workspacePath) {
  const checks = [
    { file: 'bun.lock', command: 'bun', args: ['add', '-d'] },
    { file: 'bun.lockb', command: 'bun', args: ['add', '-d'] },
    { file: 'pnpm-lock.yaml', command: 'pnpm', args: ['add', '-D'] },
    { file: 'yarn.lock', command: 'yarn', args: ['add', '-D'] },
    { file: 'package-lock.json', command: 'npm', args: ['install', '-D'] },
    { file: 'package.json', command: 'npm', args: ['install', '-D'] },
  ]

  for (const check of checks) {
    if (fs.existsSync(path.join(workspacePath, check.file))) {
      const executable = await resolveExecutable(check.command, workspacePath)
      if (executable) {
        return {
          name: check.command,
          executable,
          args: check.args,
        }
      }
    }
  }

  return null
}

export async function getInstallInfo(languageId, workspacePath) {
  const config = languageServers[languageId]
  if (!config?.install) {
    return {
      supported: false,
      label: null,
      detail: null,
    }
  }

  if (config.install.kind === 'package-manager') {
    const manager = await detectPackageManager(workspacePath)
    if (!manager) {
      return {
        supported: false,
        label: null,
        detail: 'No supported package manager was found in this workspace.',
      }
    }
    return {
      supported: true,
      label: config.install.label ?? `Install ${languageId} server`,
      detail: `Uses ${manager.name} in this workspace.`,
    }
  }

  return {
    supported: false,
    label: null,
    detail: null,
  }
}

export async function isLanguageServerAvailable(languageId, workspacePath) {
  const config = languageServers[languageId]
  if (!config) {
    return { available: true, detail: 'Built-in Monaco language support.' }
  }

  if (config.requiresGodotProject && !isGodotProject(workspacePath)) {
    return { available: false, detail: 'This file is not inside a Godot project.' }
  }

  if (config.type === 'tcp') {
    return {
      available: true,
      detail: config.installHint ?? 'External language server available.',
    }
  }

  for (const candidate of config.commands ?? []) {
    const resolved = await resolveCommandSpec(candidate, workspacePath)
    if (resolved) {
      return {
        available: true,
        detail: `Found ${candidate.command ?? path.basename(candidate.script ?? 'server')}.`,
      }
    }
  }

  return {
    available: false,
    detail: config.installHint ?? 'Language server not available.',
  }
}

export async function installLanguageServer(languageId, workspacePath) {
  const config = languageServers[languageId]
  if (!config?.install) {
    return {
      success: false,
      message: 'This language server must be installed manually.',
    }
  }

  if (config.install.kind === 'package-manager') {
    const manager = await detectPackageManager(workspacePath)
    if (!manager) {
      return {
        success: false,
        message: 'No supported package manager was found in this workspace.',
      }
    }

    const args = [...manager.args, ...config.install.packages]

    await new Promise((resolve, reject) => {
      const child = spawn(manager.executable, args, {
        cwd: workspacePath,
        windowsHide: true,
        stdio: 'ignore',
      })
      child.once('error', reject)
      child.once('exit', (code) => {
        if (code === 0) {
          resolve(true)
          return
        }
        reject(new Error(`${manager.name} exited with code ${code ?? 'unknown'}`))
      })
    })

    return {
      success: true,
      message: `${config.install.label ?? 'Language server'} installed with ${manager.name}.`,
    }
  }

  return {
    success: false,
    message: 'This language server must be installed manually.',
  }
}
