import { v4 as uuid } from 'uuid'

export function createId(prefix: string) {
  return `${prefix}-${uuid()}`
}
