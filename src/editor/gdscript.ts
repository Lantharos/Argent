import * as monaco from 'monaco-editor'

let registered = false

export function ensureGdScriptRegistered() {
  if (registered) {
    return
  }

  monaco.languages.register({
    id: 'gdscript',
    extensions: ['.gd', '.gdshader'],
    aliases: ['GDScript', 'gdscript'],
  })

  monaco.languages.setLanguageConfiguration('gdscript', {
    comments: {
      lineComment: '#',
    },
    brackets: [
      ['{', '}'],
      ['[', ']'],
      ['(', ')'],
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
    surroundingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
    onEnterRules: [
      {
        beforeText: /^.*:\s*(#.*)?$/,
        action: {
          indentAction: monaco.languages.IndentAction.Indent,
        },
      },
    ],
    indentationRules: {
      increaseIndentPattern: /^.*:\s*(#.*)?$/,
      decreaseIndentPattern: /^\s*(pass|return|break|continue)\b.*$/,
    },
  })

  monaco.languages.setMonarchTokensProvider('gdscript', {
    tokenizer: {
      root: [
        [/[a-zA-Z_][\w]*/, {
          cases: {
            'func|class_name|extends|var|const|enum|signal|static|if|elif|else|for|while|match|break|continue|return|pass|await|yield|in|and|or|not|is|as|self|super|preload|load|assert|breakpoint': 'keyword',
            'true|false|null': 'constant',
            '@default': 'identifier',
          },
        }],
        [/[{}()[\]]/, '@brackets'],
        [/[0-9]+(\.[0-9]+)?/, 'number'],
        [/".*?"/, 'string'],
        [/'.*?'/, 'string'],
        [/#.*$/, 'comment'],
      ],
    },
  })

  registered = true
}
