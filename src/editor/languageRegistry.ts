import { ensureGdScriptRegistered } from './gdscript'
import { ensureSvelteRegistered, ensureSvelteTokensProvider } from './svelte'
import type { EditorSupportKind } from './types'

export type EditorLanguageConfig = {
  id: string
  label: string
  support: EditorSupportKind
  lspLanguageId?: string
  load: () => Promise<void>
  extensions: string[]
  filenames?: string[]
}

const resolvedLoads = new Set<string>()

async function once(id: string, loader: () => Promise<unknown>) {
  if (resolvedLoads.has(id)) {
    return
  }
  await loader()
  resolvedLoads.add(id)
}

const registry: EditorLanguageConfig[] = [
  {
    id: 'typescript',
    label: 'TypeScript',
    support: 'lsp',
    lspLanguageId: 'typescript',
    extensions: ['.ts', '.tsx', '.mts', '.cts'],
    load: () => once('typescript', () => import('monaco-editor/esm/vs/language/typescript/monaco.contribution.js')),
  },
  {
    id: 'javascript',
    label: 'JavaScript',
    support: 'lsp',
    lspLanguageId: 'javascript',
    extensions: ['.js', '.jsx', '.mjs', '.cjs'],
    load: () => once('javascript', () => import('monaco-editor/esm/vs/language/typescript/monaco.contribution.js')),
  },
  {
    id: 'json',
    label: 'JSON',
    support: 'monaco',
    extensions: ['.json', '.jsonc'],
    load: () => once('json', () => import('monaco-editor/esm/vs/language/json/monaco.contribution.js')),
  },
  {
    id: 'html',
    label: 'HTML',
    support: 'monaco',
    extensions: ['.html', '.htm'],
    load: () => once('html', () => import('monaco-editor/esm/vs/language/html/monaco.contribution.js')),
  },
  {
    id: 'css',
    label: 'CSS',
    support: 'monaco',
    extensions: ['.css'],
    load: () => once('css', () => import('monaco-editor/esm/vs/language/css/monaco.contribution.js')),
  },
  {
    id: 'scss',
    label: 'SCSS',
    support: 'monaco',
    extensions: ['.scss'],
    load: () => once('scss', () => import('monaco-editor/esm/vs/language/css/monaco.contribution.js')),
  },
  {
    id: 'less',
    label: 'Less',
    support: 'monaco',
    extensions: ['.less'],
    load: () => once('less', () => import('monaco-editor/esm/vs/language/css/monaco.contribution.js')),
  },
  {
    id: 'python',
    label: 'Python',
    support: 'lsp',
    lspLanguageId: 'python',
    extensions: ['.py', '.pyi'],
    load: () => once('python', () => import('monaco-editor/esm/vs/basic-languages/python/python.contribution.js')),
  },
  {
    id: 'go',
    label: 'Go',
    support: 'lsp',
    lspLanguageId: 'go',
    extensions: ['.go'],
    load: () => once('go', () => import('monaco-editor/esm/vs/basic-languages/go/go.contribution.js')),
  },
  {
    id: 'rust',
    label: 'Rust',
    support: 'lsp',
    lspLanguageId: 'rust',
    extensions: ['.rs'],
    load: () => once('rust', () => import('monaco-editor/esm/vs/basic-languages/rust/rust.contribution.js')),
  },
  {
    id: 'cpp',
    label: 'C++',
    support: 'lsp',
    lspLanguageId: 'cpp',
    extensions: ['.cpp', '.cc', '.cxx', '.hpp', '.hh', '.hxx'],
    load: () => once('cpp', () => import('monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution.js')),
  },
  {
    id: 'c',
    label: 'C',
    support: 'lsp',
    lspLanguageId: 'c',
    extensions: ['.c', '.h'],
    load: () => once('c', () => import('monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution.js')),
  },
  {
    id: 'java',
    label: 'Java',
    support: 'basic',
    extensions: ['.java'],
    load: () => once('java', () => import('monaco-editor/esm/vs/basic-languages/java/java.contribution.js')),
  },
  {
    id: 'csharp',
    label: 'C#',
    support: 'basic',
    extensions: ['.cs'],
    load: () => once('csharp', () => import('monaco-editor/esm/vs/basic-languages/csharp/csharp.contribution.js')),
  },
  {
    id: 'php',
    label: 'PHP',
    support: 'basic',
    extensions: ['.php'],
    load: () => once('php', () => import('monaco-editor/esm/vs/basic-languages/php/php.contribution.js')),
  },
  {
    id: 'ruby',
    label: 'Ruby',
    support: 'basic',
    extensions: ['.rb'],
    load: () => once('ruby', () => import('monaco-editor/esm/vs/basic-languages/ruby/ruby.contribution.js')),
  },
  {
    id: 'lua',
    label: 'Lua',
    support: 'basic',
    extensions: ['.lua'],
    load: () => once('lua', () => import('monaco-editor/esm/vs/basic-languages/lua/lua.contribution.js')),
  },
  {
    id: 'shell',
    label: 'Shell',
    support: 'basic',
    extensions: ['.sh', '.bash', '.zsh'],
    filenames: ['.bashrc', '.zshrc', '.bash_profile'],
    load: () => once('shell', () => import('monaco-editor/esm/vs/basic-languages/shell/shell.contribution.js')),
  },
  {
    id: 'markdown',
    label: 'Markdown',
    support: 'basic',
    extensions: ['.md', '.mdx'],
    load: () => once('markdown', () => import('monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution.js')),
  },
  {
    id: 'yaml',
    label: 'YAML',
    support: 'basic',
    extensions: ['.yml', '.yaml'],
    load: () => once('yaml', () => import('monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution.js')),
  },
  {
    id: 'xml',
    label: 'XML',
    support: 'basic',
    extensions: ['.xml', '.svg'],
    load: () => once('xml', () => import('monaco-editor/esm/vs/basic-languages/xml/xml.contribution.js')),
  },
  {
    id: 'sql',
    label: 'SQL',
    support: 'basic',
    extensions: ['.sql'],
    load: () => once('sql', () => import('monaco-editor/esm/vs/basic-languages/sql/sql.contribution.js')),
  },
  {
    id: 'toml',
    label: 'TOML',
    support: 'basic',
    extensions: ['.toml'],
    load: () => once('toml', () => import('monaco-editor/esm/vs/basic-languages/ini/ini.contribution.js')),
  },
  {
    id: 'gdscript',
    label: 'GDScript',
    support: 'lsp',
    lspLanguageId: 'gdscript',
    extensions: ['.gd', '.gdshader'],
    load: async () => {
      ensureGdScriptRegistered()
      resolvedLoads.add('gdscript')
    },
  },
  {
    id: 'svelte',
    label: 'Svelte',
    support: 'lsp',
    lspLanguageId: 'svelte',
    extensions: ['.svelte'],
    load: async () => {
      await once('typescript', () => import('monaco-editor/esm/vs/language/typescript/monaco.contribution.js'))
      await once('css', () => import('monaco-editor/esm/vs/language/css/monaco.contribution.js'))
      ensureSvelteRegistered()
      ensureSvelteTokensProvider()
      resolvedLoads.add('svelte')
    },
  },
  {
    id: 'plaintext',
    label: 'Plain Text',
    support: 'basic',
    extensions: [],
    load: async () => undefined,
  },
]

const byId = new Map(registry.map((entry) => [entry.id, entry]))
const extensionMap = new Map<string, EditorLanguageConfig>()
const filenameMap = new Map<string, EditorLanguageConfig>()

for (const entry of registry) {
  for (const extension of entry.extensions) {
    extensionMap.set(extension, entry)
  }
  for (const filename of entry.filenames ?? []) {
    filenameMap.set(filename.toLowerCase(), entry)
  }
}

export function getLanguageConfig(languageId: string | null | undefined): EditorLanguageConfig {
  return byId.get(languageId ?? '') ?? byId.get('plaintext')!
}

export function detectLanguageFromPath(filePath: string | null | undefined): EditorLanguageConfig {
  if (!filePath) {
    return getLanguageConfig('plaintext')
  }

  const parts = filePath.split(/[/\\]/)
  const fileName = parts.at(-1)?.toLowerCase() ?? ''
  const explicit = filenameMap.get(fileName)
  if (explicit) {
    return explicit
  }

  const dotIndex = fileName.lastIndexOf('.')
  if (dotIndex >= 0) {
    const extension = fileName.slice(dotIndex)
    const byExtension = extensionMap.get(extension)
    if (byExtension) {
      return byExtension
    }
  }

  return getLanguageConfig('plaintext')
}

export async function ensureLanguageSupport(languageId: string | null | undefined) {
  await getLanguageConfig(languageId).load()
}

export function getLanguageLabel(languageId: string | null | undefined) {
  return getLanguageConfig(languageId).label
}
