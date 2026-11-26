import type { ChatMessage } from './domain/prompts.js'

const HOST = 'http://127.0.0.1:11434'

export const OLLAMA_ORIGIN = `${HOST}/*`

export async function ollamaChat(options: {
  model: string
  messages: ChatMessage[]
  signal?: AbortSignal
}): Promise<string> {
  const response = await fetch(`${HOST}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: options.model,
      messages: options.messages,
      stream: false,
      format: 'json',
    }),
    signal: options.signal,
  })
  if (!response.ok) throw new Error(`Ollama replied ${response.status}`)
  const body = (await response.json()) as { message?: { content?: string } }
  return body.message?.content ?? ''
}

export type LocalModel = {
  name: string
  size: number
  parameterSize: string
  quantization: string
  modifiedAt: string
}

export function parseModelList(body: unknown): LocalModel[] {
  const models = (body as { models?: unknown }).models
  if (!Array.isArray(models)) return []
  return models.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const record = item as {
      name?: unknown
      size?: unknown
      modified_at?: unknown
      details?: { parameter_size?: unknown; quantization_level?: unknown }
    }
    if (typeof record.name !== 'string' || !record.name) return []
    return [
      {
        name: record.name,
        size: typeof record.size === 'number' ? record.size : 0,
        parameterSize: typeof record.details?.parameter_size === 'string' ? record.details.parameter_size : '',
        quantization: typeof record.details?.quantization_level === 'string' ? record.details.quantization_level : '',
        modifiedAt: typeof record.modified_at === 'string' ? record.modified_at : '',
      },
    ]
  })
}

export async function listLocalModels(signal?: AbortSignal): Promise<LocalModel[]> {
  const response = await fetch(`${HOST}/api/tags`, { signal })
  if (!response.ok) throw new Error(`Ollama replied ${response.status}`)
  return parseModelList(await response.json())
}

export async function ollamaReachable(signal?: AbortSignal): Promise<boolean> {
  try {
    const response = await fetch(`${HOST}/api/tags`, { signal })
    return response.ok
  } catch {
    return false
  }
}
