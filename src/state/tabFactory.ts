import type { AppTab, AppTabType } from '../types/opensmith'
import { createId } from './ids'

export function createTab(type: AppTabType, rootPath: string): AppTab {
  const id = createId(type)

  if (type === 'ai') {
    return {
      id,
      type,
      title: 'AI Chat',
      input: '',
      providerId: null,
      model: null,
      usageByModel: {},
      messages: [],
      isGenerating: false,
      hasUnread: false,
    }
  }

  if (type === 'browser') {
    return {
      id,
      type,
      title: 'Browser',
      url: 'https://www.google.com',
      faviconUrl: null,
    }
  }

  if (type === 'terminal') {
    return {
      id,
      type,
      title: 'Terminal',
      sessionId: null,
      cwd: rootPath,
      history: '',
    }
  }

  if (type === 'git') {
    return {
      id,
      type,
      title: 'Git',
      cwd: rootPath,
    }
  }

  return {
    id,
    type,
    title: 'Editor',
    filePath: null,
    content: '',
    language: 'javascript',
    dirty: false,
  }
}
