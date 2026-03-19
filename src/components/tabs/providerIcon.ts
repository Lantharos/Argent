import { createElement, type ElementType } from 'react'
import { toc } from '@lobehub/icons'
import * as LobeIcons from '@lobehub/icons'
import { Sparkles } from 'lucide-react'

type IconTocEntry = {
  id: string
  title?: string
  fullTitle?: string
  group?: 'model' | 'provider' | 'application' | string
}

type ProviderMatchEntry = {
  iconId: string
  idNorm: string
  titleNorm: string
  fullTitleNorm: string
  compositeNorm: string
}

type LobeIconComponentProps = {
  size?: number | string
  className?: string
}

function normalizeMatchText(value: string | null | undefined) {
  return (value || '').toLowerCase().trim().replace(/[^a-z0-9]/g, '')
}

function splitMatchWords(value: string | null | undefined) {
  return (value || '').toLowerCase().trim().split(/[^a-z0-9]+/).filter(Boolean)
}

const providerMatchEntries: ProviderMatchEntry[] = (toc as IconTocEntry[])
  .filter((entry) => entry.group === 'provider' || entry.group === 'application')
  .map((entry) => {
    const idNorm = normalizeMatchText(entry.id)
    const titleNorm = normalizeMatchText(entry.title)
    const fullTitleNorm = normalizeMatchText(entry.fullTitle)
    const compositeNorm = `${idNorm}${titleNorm}${fullTitleNorm}`
    return {
      iconId: entry.id,
      idNorm,
      titleNorm,
      fullTitleNorm,
      compositeNorm,
    }
  })
  .filter((entry) => entry.idNorm.length > 0)

export function normalizeProviderKey(raw: string | null | undefined) {
  if (!raw) return null

  const normalized = normalizeMatchText(raw)
  const words = splitMatchWords(raw)
  const firstWordNorm = normalizeMatchText(words[0] || '')
  if (!normalized) return null

  for (const entry of providerMatchEntries) {
    if (normalized === entry.idNorm || normalized === entry.titleNorm || normalized === entry.fullTitleNorm) {
      return entry.iconId
    }
  }

  if (firstWordNorm) {
    const firstWordMatches = providerMatchEntries.filter((entry) => {
      return (
        entry.idNorm.startsWith(firstWordNorm) ||
        entry.titleNorm.startsWith(firstWordNorm) ||
        entry.fullTitleNorm.startsWith(firstWordNorm) ||
        entry.compositeNorm.includes(firstWordNorm)
      )
    })

    if (firstWordNorm === 'github') {
      const copilotMatch = firstWordMatches.find((entry) => {
        return (
          entry.idNorm.includes('githubcopilot') ||
          entry.titleNorm.includes('githubcopilot') ||
          entry.fullTitleNorm.includes('githubcopilot') ||
          entry.compositeNorm.includes('copilot')
        )
      })
      if (copilotMatch) {
        return copilotMatch.iconId
      }
    }

    let firstWordBest: { iconId: string; score: number } | null = null
    for (const entry of firstWordMatches) {
      let score = 0
      if (entry.idNorm.startsWith(firstWordNorm)) {
        score = Math.max(score, 120 + entry.idNorm.length)
      }
      if (entry.titleNorm.startsWith(firstWordNorm)) {
        score = Math.max(score, 110 + entry.titleNorm.length)
      }
      if (entry.fullTitleNorm.startsWith(firstWordNorm)) {
        score = Math.max(score, 100 + entry.fullTitleNorm.length)
      }
      if (score === 0 && entry.compositeNorm.includes(firstWordNorm)) {
        score = 60 + firstWordNorm.length
      }

      if (!firstWordBest || score > firstWordBest.score) {
        firstWordBest = { iconId: entry.iconId, score }
      }
    }

    if (firstWordBest) {
      return firstWordBest.iconId
    }
  }

  let best: { iconId: string; score: number } | null = null
  for (const entry of providerMatchEntries) {
    let score = 0

    if (entry.idNorm && normalized.includes(entry.idNorm)) {
      score = Math.max(score, entry.idNorm.length + 12)
    }
    if (entry.titleNorm && normalized.includes(entry.titleNorm)) {
      score = Math.max(score, entry.titleNorm.length + 10)
    }
    if (entry.fullTitleNorm && normalized.includes(entry.fullTitleNorm)) {
      score = Math.max(score, entry.fullTitleNorm.length + 8)
    }

    if (score === 0 && entry.compositeNorm.includes(normalized) && normalized.length >= 4) {
      score = normalized.length
    }

    if (score > 0 && (!best || score > best.score)) {
      best = { iconId: entry.iconId, score }
    }
  }

  if (best) {
    return best.iconId
  }

  return null
}

export function extractModelMeta(
  modelLabel: string | null | undefined,
  modelId: string | null | undefined,
  providerHint?: string | null,
) {
  const safeLabel = (modelLabel || '').trim()
  const safeId = (modelId || '').trim()

  const labelSlash = safeLabel.indexOf('/')
  const idSlash = safeId.indexOf('/')

  const labelProvider = labelSlash > 0 ? safeLabel.slice(0, labelSlash).trim() : null
  const labelName = labelSlash > 0 ? safeLabel.slice(labelSlash + 1).trim() : null
  const idProvider = idSlash > 0 ? safeId.slice(0, idSlash).trim() : null
  const idName = idSlash > 0 ? safeId.slice(idSlash + 1).trim() : null

  const providerLabel = labelProvider || idProvider || providerHint || null
  const modelName = labelName || idName || safeLabel || safeId || 'Model'

  return {
    providerKey: normalizeProviderKey(providerLabel),
    modelName,
  }
}

export function ProviderGlyph({ providerKey, className }: { providerKey: string | null; className?: string }) {
  if (!providerKey) {
    return createElement(Sparkles, { className: className || 'h-3.5 w-3.5 text-[#9a9a9a]' })
  }

  const iconModule = LobeIcons as Record<string, unknown>
  const iconCandidate = iconModule[providerKey]
  if (iconCandidate) {
    const IconComponent = iconCandidate as ElementType<LobeIconComponentProps>
    return createElement(IconComponent, { size: 14, className: className || 'text-[#bdbdbd]' })
  }

  return createElement(Sparkles, { className: className || 'h-3.5 w-3.5 text-[#9a9a9a]' })
}
