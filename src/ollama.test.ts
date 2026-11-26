import { describe, expect, it } from 'vitest'
import {
  describeOllamaFailure,
  describeOllamaOriginsBlock,
  ollamaOriginsLaunchCommand,
  parseModelList,
} from './ollama.js'

describe('parseModelList', () => {
  it('reads the models Ollama lists', () => {
    expect(
      parseModelList({
        models: [
          {
            name: 'qwen2.5-coder:7b',
            size: 4_683_087_561,
            modified_at: '2026-04-26T02:48:39.127Z',
            details: { parameter_size: '7.6B', quantization_level: 'Q4_K_M' },
          },
        ],
      }),
    ).toEqual([
      {
        name: 'qwen2.5-coder:7b',
        size: 4_683_087_561,
        parameterSize: '7.6B',
        quantization: 'Q4_K_M',
        modifiedAt: '2026-04-26T02:48:39.127Z',
      },
    ])
  })

  it('returns nothing for an empty body', () => {
    expect(parseModelList({})).toEqual([])
  })
})

describe('describeOllamaFailure', () => {
  it('tells the user how to start Ollama when the connection fails', () => {
    expect(describeOllamaFailure(new TypeError('Failed to fetch'))).toContain('ollama serve')
  })

  it('keeps timeout failures distinct from a down host', () => {
    const error = new Error(
      'Ollama timed out. The model may still be loading — wait and try again, or pick a smaller model.',
    )
    error.name = 'TimeoutError'
    expect(describeOllamaFailure(error)).toContain('timed out')
    expect(describeOllamaFailure(error)).toContain('smaller model')
    expect(describeOllamaFailure(error)).not.toContain("isn't running")
  })

  it('supplies actionable copy when AbortError has no timeout wording', () => {
    const error = new Error('The operation was aborted')
    error.name = 'AbortError'
    expect(describeOllamaFailure(error)).toContain('smaller model')
  })

  it('flags a missing model name', () => {
    expect(describeOllamaFailure(new Error('Ollama replied 404'))).toContain('not installed')
  })

  it('explains OLLAMA_ORIGINS when Ollama returns 403', () => {
    const message = describeOllamaFailure(
      new Error('Ollama replied 403'),
      'abcdefghijklmnopqrstuvwxyzabcdef',
    )
    expect(message).toContain('blocked this extension (403)')
    expect(message).toContain(
      'OLLAMA_ORIGINS=chrome-extension://abcdefghijklmnopqrstuvwxyzabcdef ollama serve',
    )
    expect(message).toContain('OLLAMA_ORIGINS=*')
  })

  it('falls back to a wildcard origin when no extension id is known', () => {
    expect(ollamaOriginsLaunchCommand()).toBe('OLLAMA_ORIGINS=chrome-extension://* ollama serve')
    expect(describeOllamaOriginsBlock()).toContain('chrome-extension://*')
  })
})
