import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

export function getDataDir() {
  const dir = path.join(app.getPath('userData'), 'opensmith')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function getStatePath() {
  return path.join(getDataDir(), 'state.json')
}

export function getProvidersPath() {
  return path.join(getDataDir(), 'providers.json')
}

export function getSecretsPath() {
  return path.join(getDataDir(), 'secrets.bin')
}
