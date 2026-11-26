import { describe, expect, it } from 'vitest'
import { parseModelList } from './ollama.js'

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
