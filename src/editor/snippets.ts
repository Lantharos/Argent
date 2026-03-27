import type { editor as MonacoEditor, IDisposable } from 'monaco-editor'
import { monaco } from './monaco'

type SnippetTemplate = {
  label: string
  detail: string
  documentation?: string
  insertText: string
  languages: string[]
  fileExtensions?: string[]
}

const snippetTemplates: SnippetTemplate[] = [
  {
    label: 'doctype',
    detail: 'HTML document',
    documentation: 'Insert a full HTML5 document skeleton.',
    languages: ['html'],
    insertText: [
      '<!DOCTYPE html>',
      '<html lang="en">',
      '<head>',
      '\t<meta charset="UTF-8" />',
      '\t<meta name="viewport" content="width=device-width, initial-scale=1.0" />',
      '\t<title>${1:Document}</title>',
      '</head>',
      '<body>',
      '\t$0',
      '</body>',
      '</html>',
    ].join('\n'),
  },
  {
    label: 'html:5',
    detail: 'HTML5 document',
    documentation: 'Insert a full HTML5 document skeleton.',
    languages: ['html'],
    insertText: [
      '<!DOCTYPE html>',
      '<html lang="en">',
      '<head>',
      '\t<meta charset="UTF-8" />',
      '\t<meta name="viewport" content="width=device-width, initial-scale=1.0" />',
      '\t<title>${1:Document}</title>',
      '</head>',
      '<body>',
      '\t$0',
      '</body>',
      '</html>',
    ].join('\n'),
  },
  {
    label: 'link:css',
    detail: 'Stylesheet link',
    documentation: 'Insert a stylesheet link tag.',
    languages: ['html'],
    insertText: '<link rel="stylesheet" href="${1:styles.css}" />',
  },
  {
    label: 'script:src',
    detail: 'External script',
    documentation: 'Insert a script tag that loads an external file.',
    languages: ['html'],
    insertText: '<script src="${1:app.js}"></script>',
  },
  {
    label: 'fetch',
    detail: 'Fetch request',
    documentation: 'Insert a basic fetch call.',
    languages: ['javascript', 'typescript'],
    insertText: [
      'const response = await fetch(${1:url})',
      '',
      'if (!response.ok) {',
      '\tthrow new Error(`Request failed: ${response.status}`)',
      '}',
      '',
      'const data = await response.json()',
      '$0',
    ].join('\n'),
  },
  {
    label: 'fn',
    detail: 'Function declaration',
    documentation: 'Insert a named function.',
    languages: ['javascript', 'typescript'],
    insertText: ['function ${1:name}(${2:params}) {', '\t$0', '}'].join('\n'),
  },
  {
    label: 'afn',
    detail: 'Async function',
    documentation: 'Insert an async function.',
    languages: ['javascript', 'typescript'],
    insertText: ['async function ${1:name}(${2:params}) {', '\t$0', '}'].join('\n'),
  },
  {
    label: 'clg',
    detail: 'Console log',
    documentation: 'Insert a console.log statement.',
    languages: ['javascript', 'typescript'],
    insertText: 'console.log(${1:value})$0',
  },
  {
    label: 'rfc',
    detail: 'React function component (TSX)',
    documentation: 'Insert a typed React function component.',
    languages: ['javascript', 'typescript'],
    fileExtensions: ['.tsx'],
    insertText: [
      'type ${1:ComponentName}Props = {',
      '\t$2',
      '}',
      '',
      'export function ${1:ComponentName}({}: ${1:ComponentName}Props) {',
      '\treturn (',
      '\t\t<div>$0</div>',
      '\t)',
      '}',
    ].join('\n'),
  },
  {
    label: 'rfc',
    detail: 'React function component (JSX)',
    documentation: 'Insert a React function component.',
    languages: ['javascript', 'typescript'],
    fileExtensions: ['.jsx'],
    insertText: [
      'export function ${1:ComponentName}() {',
      '\treturn (',
      '\t\t<div>$0</div>',
      '\t)',
      '}',
    ].join('\n'),
  },
  {
    label: 'useEffect',
    detail: 'React effect',
    documentation: 'Insert a React useEffect block.',
    languages: ['javascript', 'typescript'],
    fileExtensions: ['.jsx', '.tsx'],
    insertText: [
      'useEffect(() => {',
      '\t$0',
      '}, [${1:dependencies}])',
    ].join('\n'),
  },
  {
    label: 'usestate',
    detail: 'React state',
    documentation: 'Insert a React useState declaration.',
    languages: ['javascript', 'typescript'],
    fileExtensions: ['.jsx', '.tsx'],
    insertText: 'const [${1:value}, set${2:Value}] = useState(${3:null})$0',
  },
  {
    label: 'component',
    detail: 'Svelte component',
    documentation: 'Insert a basic Svelte component scaffold.',
    languages: ['svelte'],
    insertText: [
      '<script lang="ts">',
      '\t$1',
      '</script>',
      '',
      '<div>',
      '\t$0',
      '</div>',
    ].join('\n'),
  },
  {
    label: 'style',
    detail: 'Svelte style block',
    documentation: 'Insert a Svelte style block.',
    languages: ['svelte'],
    insertText: ['<style>', '\t$0', '</style>'].join('\n'),
  },
  {
    label: 'rule',
    detail: 'CSS rule',
    documentation: 'Insert a CSS rule block.',
    languages: ['css', 'scss', 'less'],
    insertText: ['.${1:selector} {', '\t$0', '}'].join('\n'),
  },
  {
    label: 'media',
    detail: 'Media query',
    documentation: 'Insert a media query block.',
    languages: ['css', 'scss', 'less'],
    insertText: ['@media (${1:max-width: 768px}) {', '\t$0', '}'].join('\n'),
  },
  {
    label: 'object',
    detail: 'JSON object',
    documentation: 'Insert a JSON object.',
    languages: ['json'],
    insertText: ['{', '\t"${1:key}": "${2:value}"', '}'].join('\n'),
  },
]

const registeredProviders = new Map<string, IDisposable>()

function getFileExtension(model: MonacoEditor.ITextModel) {
  const fileName = model.uri.path.split('/').at(-1)?.toLowerCase() ?? ''
  const dotIndex = fileName.lastIndexOf('.')
  if (dotIndex < 0) {
    return ''
  }
  return fileName.slice(dotIndex)
}

function getTemplatesForModel(languageId: string, model: MonacoEditor.ITextModel) {
  const fileExtension = getFileExtension(model)
  return snippetTemplates.filter((template) => {
    if (!template.languages.includes(languageId)) {
      return false
    }
    if (!template.fileExtensions?.length) {
      return true
    }
    return template.fileExtensions.includes(fileExtension)
  })
}

export function ensureSnippetProvider(languageId: string | null | undefined) {
  if (!languageId || registeredProviders.has(languageId)) {
    return
  }

  const provider = monaco.languages.registerCompletionItemProvider(languageId, {
    provideCompletionItems(model, position) {
      const templates = getTemplatesForModel(languageId, model)
      if (!templates.length) {
        return { suggestions: [] }
      }

      const word = model.getWordUntilPosition(position)
      const range = new monaco.Range(
        position.lineNumber,
        word.startColumn,
        position.lineNumber,
        word.endColumn,
      )

      const suggestions = templates.map((template, index) => ({
        label: template.label,
        detail: template.detail,
        documentation: template.documentation,
        kind: monaco.languages.CompletionItemKind.Snippet,
        insertText: template.insertText,
        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        range,
        sortText: `0${index.toString().padStart(3, '0')}`,
      }))

      return { suggestions }
    },
  })

  registeredProviders.set(languageId, provider)
}
