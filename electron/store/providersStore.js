import fs from 'node:fs'
import { safeStorage } from 'electron'
import { getProvidersPath, getSecretsPath } from './paths.js'

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
  const providers = loadJson(getProvidersPath(), [])
  const secrets = loadEncryptedSecrets()
  return providers.map((provider) => ({ ...provider, hasApiKey: Boolean(secrets[provider.id]) }))
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

  const presets = [
    {
      id: 'codex-app-server',
      label: 'Codex App Server',
      kind: 'codex-app-server',
      model: 'gpt-5.1-codex',
      endpoint: 'http://127.0.0.1:4141/v1',
      headers: {},
    },
    {
      id: 'copilot-sdk',
      label: 'Copilot SDK',
      kind: 'copilot-sdk',
      model: 'copilot-chat',
      endpoint: 'http://127.0.0.1:4142/v1',
      headers: {},
    },
  ]

  if (current.length === 0) {
    saveJson(getProvidersPath(), presets)
    return
  }

  const map = new Map(current.map((provider) => [provider.id, provider]))
  for (const preset of presets) {
    const existing = map.get(preset.id)
    if (!existing) {
      map.set(preset.id, preset)
      continue
    }

    map.set(preset.id, {
      ...existing,
      label: preset.label,
      kind: preset.kind,
      model: preset.model,
      endpoint: preset.endpoint,
      headers: existing.headers ?? {},
    })
  }

  saveJson(getProvidersPath(), Array.from(map.values()))
}
