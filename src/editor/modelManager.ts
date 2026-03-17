import type { editor } from 'monaco-editor'
import { monaco } from './monaco'
import { ensureLanguageSupport } from './languageRegistry'

const modelOwners = new Map<string, number>()

function getModelUri(filePath: string) {
  return monaco.Uri.file(filePath)
}

export async function ensureEditorModel(filePath: string, languageId: string, content: string) {
  await ensureLanguageSupport(languageId)

  const uri = getModelUri(filePath)
  let model = monaco.editor.getModel(uri)
  if (!model) {
    model = monaco.editor.createModel(content, languageId, uri)
  } else {
    if (model.getLanguageId() !== languageId) {
      monaco.editor.setModelLanguage(model, languageId)
    }
    if (model.getValue() !== content) {
      model.setValue(content)
    }
  }

  modelOwners.set(uri.toString(), (modelOwners.get(uri.toString()) ?? 0) + 1)
  return model
}

export function releaseEditorModel(filePath: string) {
  const uri = getModelUri(filePath).toString()
  const nextOwners = (modelOwners.get(uri) ?? 1) - 1
  if (nextOwners <= 0) {
    modelOwners.delete(uri)
    return
  }
  modelOwners.set(uri, nextOwners)
}

export function getExistingModel(filePath: string): editor.ITextModel | null {
  return monaco.editor.getModel(getModelUri(filePath))
}
