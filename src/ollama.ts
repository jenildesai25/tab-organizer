import type { ChatMessage } from './domain/prompts.js'

const HOST = 'http://127.0.0.1:11434'

export const OLLAMA_ORIGIN = `${HOST}/*`
export const OLLAMA_HOST_PERMISSIONS = [
  'http://127.0.0.1:11434/*',
  'http://localhost:11434/*',
] as const

const DOWN_MESSAGE =
  "Ollama isn't running. Start it with `ollama serve`, then hit Refresh."

/** Env value that lets Chrome extensions call a local Ollama. */
export function ollamaOriginsAllowlist(extensionId?: string): string {
  const id = extensionId?.trim()
  return id ? `chrome-extension://${id}` : 'chrome-extension://*'
}

/** One-line shell launch for macOS/zsh (and other shells that take env prefixes). */
export function ollamaOriginsLaunchCommand(extensionId?: string): string {
  return `OLLAMA_ORIGINS=${ollamaOriginsAllowlist(extensionId)} ollama serve`
}

export function describeOllamaOriginsBlock(extensionId?: string): string {
  const launch = ollamaOriginsLaunchCommand(extensionId)
  return (
    `Ollama blocked this extension (403). Chrome sends Origin: chrome-extension://…. ` +
    `Quit Ollama, then start it with:\n${launch}\n` +
    `Or use OLLAMA_ORIGINS=* if you want every origin allowed.`
  )
}

function extensionIdHint(): string | undefined {
  try {
    return typeof chrome !== 'undefined' ? chrome.runtime?.id : undefined
  } catch {
    return undefined
  }
}

export function describeOllamaFailure(error: unknown, extensionId = extensionIdHint()): string {
  if (error && typeof error === 'object') {
    const name = 'name' in error && typeof error.name === 'string' ? error.name : ''
    const message = 'message' in error && typeof error.message === 'string' ? error.message : ''
    if (name === 'TimeoutError' || name === 'AbortError' || /timed out/i.test(message)) {
      return message && /timed out/i.test(message)
        ? message
        : 'Ollama timed out. The model may still be loading — wait and try again, or pick a smaller model.'
    }
    if (/Ollama replied 404/i.test(message)) {
      return 'That model is not installed in Ollama.'
    }
    if (/Ollama replied 403/i.test(message)) {
      return describeOllamaOriginsBlock(extensionId)
    }
    if (/Ollama replied \d+/i.test(message)) {
      return message
    }
    if (name === 'TypeError' || /Failed to fetch|NetworkError|ECONNREFUSED/i.test(message)) {
      return DOWN_MESSAGE
    }
    if (message) return message
  }
  return DOWN_MESSAGE
}

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

export { DOWN_MESSAGE as OLLAMA_DOWN_MESSAGE }
