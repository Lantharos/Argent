import * as monaco from 'monaco-editor'
import { conf as htmlConf, language as htmlLanguage } from 'monaco-editor/esm/vs/basic-languages/html/html.js'

let registered = false
let tokensProviderRegistered = false

export function ensureSvelteRegistered() {
  if (registered) {
    return
  }

  const htmlComments = htmlConf.comments

  monaco.languages.register({
    id: 'svelte',
    extensions: ['.svelte'],
    aliases: ['Svelte', 'svelte'],
    mimetypes: ['text/x-svelte'],
  })

  monaco.languages.setLanguageConfiguration('svelte', {
    ...htmlConf,
    comments: {
      ...(htmlComments && 'blockComment' in htmlComments ? { blockComment: htmlComments.blockComment } : {}),
      lineComment: '//',
    },
    brackets: [
      ...(htmlConf.brackets ?? []),
      ['[', ']'],
    ],
    autoClosingPairs: [
      ...(htmlConf.autoClosingPairs ?? []),
      { open: '<', close: '>' },
    ],
    surroundingPairs: [
      ...(htmlConf.surroundingPairs ?? []),
      { open: '[', close: ']' },
    ],
  })

  registered = true
}

export function ensureSvelteTokensProvider() {
  if (tokensProviderRegistered) {
    return
  }

  const tokenizer = cloneTokenizer(htmlLanguage.tokenizer)
  tokenizer.root = insertSvelteBraces(tokenizer.root)
  tokenizer.otherTag = addSvelteTagRules(tokenizer.otherTag)
  tokenizer.script = addSvelteScriptRules(tokenizer.script)
  tokenizer.scriptAfterType = addSvelteScriptAfterTypeRules(tokenizer.scriptAfterType)
  tokenizer.scriptAfterTypeEquals = addSvelteScriptAfterTypeEqualsRules(tokenizer.scriptAfterTypeEquals)
  tokenizer.scriptWithCustomType = addSvelteTagRules(tokenizer.scriptWithCustomType)
  tokenizer.style = addSvelteStyleRules(tokenizer.style)
  tokenizer.styleWithCustomType = addSvelteTagRules(tokenizer.styleWithCustomType)
  tokenizer.svelteExpression = createSvelteExpressionTokenizer()
  tokenizer.scriptAfterLang = [
    [/=/, 'delimiter', '@scriptAfterLangEquals'],
    [/>/, { token: 'delimiter', next: '@scriptEmbedded', nextEmbedded: 'text/javascript' }],
    [/[ \t\r\n]+/],
    [/<\/script\s*>/, { token: '@rematch', next: '@pop' }],
  ]
  tokenizer.scriptAfterLangEquals = [
    [/"ts"/, { token: 'attribute.value', switchTo: '@scriptWithCustomType.text/typescript' }],
    [/'ts'/, { token: 'attribute.value', switchTo: '@scriptWithCustomType.text/typescript' }],
    [/"typescript"/, { token: 'attribute.value', switchTo: '@scriptWithCustomType.text/typescript' }],
    [/'typescript'/, { token: 'attribute.value', switchTo: '@scriptWithCustomType.text/typescript' }],
    [/"js"/, { token: 'attribute.value', switchTo: '@scriptWithCustomType.text/javascript' }],
    [/'js'/, { token: 'attribute.value', switchTo: '@scriptWithCustomType.text/javascript' }],
    [/"javascript"/, { token: 'attribute.value', switchTo: '@scriptWithCustomType.text/javascript' }],
    [/'javascript'/, { token: 'attribute.value', switchTo: '@scriptWithCustomType.text/javascript' }],
    [/"([^"]*)"/, { token: 'attribute.value', switchTo: '@scriptWithCustomType.$1' }],
    [/'([^']*)'/, { token: 'attribute.value', switchTo: '@scriptWithCustomType.$1' }],
    [/>/, { token: 'delimiter', next: '@scriptEmbedded', nextEmbedded: 'text/javascript' }],
    [/[ \t\r\n]+/],
    [/<\/script\s*>/, { token: '@rematch', next: '@pop' }],
  ]
  tokenizer.stringDouble = [
    [/[^\\"]+/, 'string'],
    [/\\./, 'string.escape'],
    [/"/, 'string', '@pop'],
  ]
  tokenizer.stringSingle = [
    [/[^\\']+/, 'string'],
    [/\\./, 'string.escape'],
    [/'/, 'string', '@pop'],
  ]

  monaco.languages.setMonarchTokensProvider('svelte', {
    ...htmlLanguage,
    tokenPostfix: '.svelte',
    tokenizer,
  } as monaco.languages.IMonarchLanguage)

  tokensProviderRegistered = true
}

function cloneTokenizer(tokenizer: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(tokenizer).map(([state, rules]) => [state, Array.isArray(rules) ? [...rules] : rules]),
  ) as Record<string, unknown[]>
}

function insertSvelteBraces(rules: unknown[]) {
  const fallbackRule = rules.at(-1)
  const htmlRules = fallbackRule ? rules.slice(0, -1) : [...rules]
  return [
    ...htmlRules,
    [/\{[#:@/]?/, { token: 'delimiter.bracket', next: '@svelteExpression' }],
    ...(fallbackRule ? [fallbackRule] : []),
  ]
}

function addSvelteTagRules(rules: unknown[]) {
  return [
    [/\{[#:@/]?/, { token: 'delimiter.bracket', next: '@svelteExpression' }],
    ...replaceAttributeNameMatchers(rules),
  ]
}

function addSvelteScriptRules(rules: unknown[]) {
  return addSvelteTagRules([
    [/lang/, 'attribute.name', '@scriptAfterLang'],
    ...rules,
  ])
}

function addSvelteScriptAfterTypeRules(rules: unknown[]) {
  return [
    [/lang/, 'attribute.name', '@scriptAfterLang'],
    ...rules,
  ]
}

function addSvelteScriptAfterTypeEqualsRules(rules: unknown[]) {
  return [
    [/"text[/]typescript"/, { token: 'attribute.value', switchTo: '@scriptWithCustomType.text/typescript' }],
    [/'text[/]typescript'/, { token: 'attribute.value', switchTo: '@scriptWithCustomType.text/typescript' }],
    ...rules,
  ]
}

function addSvelteStyleRules(rules: unknown[]) {
  return addSvelteTagRules(rules)
}

function replaceAttributeNameMatchers(rules: unknown[]) {
  return rules.map((rule) => {
    if (!Array.isArray(rule)) {
      return rule
    }
    const [matcher, ...rest] = rule
    if (matcher instanceof RegExp && matcher.source === '[\\w\\-]+') {
      return [/[^\s"'<>/=]+/, ...rest]
    }
    return rule
  })
}

function createSvelteExpressionTokenizer() {
  return [
    [/\}/, { token: 'delimiter.bracket', next: '@pop' }],
    [/\b(?:if|else|each|await|then|catch|key|snippet|html|const|debug|render)\b/, 'keyword'],
    [/\$[A-Za-z_]\w*/, 'variable'],
    [/[A-Za-z_]\w*/, 'identifier'],
    [/[{}()[\]]/, '@brackets'],
    [/[!%&*+=|?:/-]+/, 'operators'],
    [/\d+(\.\d+)?/, 'number'],
    [/"/, 'string', '@stringDouble'],
    [/'/, 'string', '@stringSingle'],
    [/\s+/, ''],
  ]
}
