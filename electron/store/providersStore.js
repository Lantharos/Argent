import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { safeStorage } from 'electron'
import { getProvidersPath, getSecretsPath } from './paths.js'

const BUILTIN_PROVIDER_IDS = new Set(['opencode-acp'])

function commandExists(command) {
  const checker = process.platform === 'win32' ? 'where' : 'which'
  const probe = spawnSync(checker, [command], {
    windowsHide: true,
    stdio: 'ignore',
  })
  return probe.status === 0
}

function detectBuiltinProviders() {
  const providers = []

  if (commandExists('opencode')) {
    providers.push({
      id: 'opencode-acp',
      label: 'OpenCode ACP',
      kind: 'acp-opencode',
      model: 'opencode/big-pickle',
      endpoint: 'stdio://opencode-acp',
      headers: {},
      source: 'detected',
    })
  }

  return providers
}

function loadJson(path, fallback) {
  try {
    const content = fs.readFileSync(path, 'utf8')
    return JSON.parse(content)
  } catch {
    return fallback
  }
}

function saveJson(path, value) {
  fs.writeFileSync(path, JSON.stringify(value, null, 2), 'utf8')
}

function loadEncryptedSecrets() {
  try {
    const blob = fs.readFileSync(getSecretsPath())
    if (!safeStorage.isEncryptionAvailable()) {
      return {}
    }
    const raw = safeStorage.decryptString(blob)
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

function saveEncryptedSecrets(secrets) {
  if (!safeStorage.isEncryptionAvailable()) {
    return false
  }
  const raw = JSON.stringify(secrets)
  const encrypted = safeStorage.encryptString(raw)
  fs.writeFileSync(getSecretsPath(), encrypted)
  return true
}

export function listProviders() {
  const savedProviders = loadJson(getProvidersPath(), [])
  const detectedProviders = detectBuiltinProviders()
  const merged = new Map()

  for (const provider of savedProviders) {
    if (BUILTIN_PROVIDER_IDS.has(provider.id) || provider.id !== 'opencode-acp') {
      continue
    }
    merged.set(provider.id, provider)
  }

  for (const provider of detectedProviders) {
    const existing = savedProviders.find((item) => item.id === provider.id)
    merged.set(provider.id, {
      ...provider,
      model: existing?.model || provider.model,
      headers: existing?.headers || provider.headers,
    })
  }

  const secrets = loadEncryptedSecrets()
  return Array.from(merged.values()).map((provider) => ({ ...provider, hasApiKey: Boolean(secrets[provider.id]) }))
}

export function upsertProvider(payload) {
  const providers = loadJson(getProvidersPath(), [])
  const secrets = loadEncryptedSecrets()
  const index = providers.findIndex((provider) => provider.id === payload.id)

  const base = {
    id: payload.id,
    label: payload.label,
    kind: payload.kind,
    model: payload.model,
    endpoint: payload.endpoint,
    headers: payload.headers,
    source: payload.source || 'manual',
  }

  if (index === -1) {
    providers.push(base)
  } else {
    providers[index] = base
  }

  if (payload.apiKey) {
    secrets[payload.id] = payload.apiKey
    saveEncryptedSecrets(secrets)
  }

  saveJson(getProvidersPath(), providers)
  return base
}

export function removeProvider(providerId) {
  const providers = loadJson(getProvidersPath(), [])
  const secrets = loadEncryptedSecrets()
  const nextProviders = providers.filter((provider) => provider.id !== providerId)

  delete secrets[providerId]
  saveJson(getProvidersPath(), nextProviders)
  saveEncryptedSecrets(secrets)
  return true
}

export function getProviderSecret(providerId) {
  const secrets = loadEncryptedSecrets()
  return secrets[providerId] ?? null
}

export function ensureDefaultProviders() {
  const current = loadJson(getProvidersPath(), [])

  if (current.length === 0) {
    saveJson(getProvidersPath(), [])
  }
}
