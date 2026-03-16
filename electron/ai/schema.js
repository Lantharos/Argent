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

export const chatRequestSchema = z.object({
  providerId: z.string().min(1),
  messages: z.array(messageSchema).min(1),
  model: z.string().min(1).optional(),
  modeId: z.string().min(1).optional(),
  temperature: z.number().min(0).max(2).optional(),
  cwd: z.string().optional(),
  sessionId: z.string().min(1).optional(),
})
