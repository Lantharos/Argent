import { z } from 'zod'

export const providerSchema = z.object({
  id: z.string().min(2),
  label: z.string().min(2),
  kind: z.enum(['acp-opencode']),
  model: z.string().min(1),
  endpoint: z.string().url(),
  headers: z.record(z.string(), z.string()).default({}),
  apiKey: z.string().optional(),
  source: z.enum(['manual', 'detected']).optional(),
})

export const messageSchema = z.object({
  role: z.enum(['system', 'developer', 'user', 'assistant']),
  content: z.string().min(1),
})

export const attachmentSchema = z.discriminatedUnion('kind', [
  z.object({
    id: z.string().min(1),
    kind: z.literal('file'),
    name: z.string().min(1),
    path: z.string().min(1),
    mimeType: z.string().min(1).optional(),
  }),
  z.object({
    id: z.string().min(1),
    kind: z.literal('image'),
    name: z.string().min(1),
    data: z.string().min(1),
    mimeType: z.string().min(1).optional(),
  }),
])

export const chatRequestSchema = z.object({
  providerId: z.string().min(1),
  messages: z.array(messageSchema).min(1),
  attachments: z.array(attachmentSchema).max(24).optional(),
  model: z.string().min(1).optional(),
  modeId: z.string().min(1).optional(),
  temperature: z.number().min(0).max(2).optional(),
  cwd: z.string().optional(),
  sessionId: z.string().min(1).optional(),
})
