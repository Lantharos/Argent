import fs from 'node:fs'
import { getStatePath } from './paths.js'

const FALLBACK_STATE = {
  spaces: [],
  activeSpaceId: null,
}

export function loadState() {
  try {
    const file = fs.readFileSync(getStatePath(), 'utf8')
    const parsed = JSON.parse(file)
    if (!parsed || typeof parsed !== 'object') {
      return FALLBACK_STATE
    }
    return parsed
  } catch {
    return FALLBACK_STATE
  }
}

export function saveState(nextState) {
  const serialized = JSON.stringify(nextState, null, 2)
  fs.writeFileSync(getStatePath(), serialized, 'utf8')
  return true
}
