import { fixtures } from '../evals/fixtures/cases.ts'
import { advisorMessages, parseAdvisorContent } from '../src/domain/prompts.ts'
import { ollamaChat } from '../src/ollama.ts'

const model = process.env.OLLAMA_MODEL?.trim()
if (!model) {
  console.error('Set OLLAMA_MODEL to the model you pulled.')
  process.exit(1)
}

const cases = fixtures.filter((fixture) => fixture.uncertain && fixture.expectedTitle)
if (cases.length === 0) {
  console.error('No uncertain fixtures to compare.')
  process.exit(1)
}

let correct = 0
let latencyTotal = 0

for (const fixture of cases) {
  const tab = fixture.input.tabs[0]
  if (!tab) continue
  const groups = fixture.input.groups.map((group) => ({
    id: group.id,
    title: group.title,
    domains: group.domains,
    words: group.words,
    size: group.size,
  }))
  const started = performance.now()
  let got = ''
  let confidence = ''
  let raw = ''
  try {
    raw = await ollamaChat({ model, messages: advisorMessages(tab.card, groups) })
    const parsed = parseAdvisorContent(raw)
    got = parsed?.title ?? ''
    confidence = parsed ? String(parsed.confidence) : 'unparsed'
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Ollama is not reachable.')
    process.exit(1)
  }
  const elapsed = Math.round(performance.now() - started)
  latencyTotal += elapsed
  const expected = fixture.expectedTitle ?? ''
  const pass = got.toLowerCase() === expected.toLowerCase()
  if (pass) correct += 1
  console.log(
    `${pass ? 'pass' : 'fail'}  ${fixture.name}: expected "${expected}", got "${got}", confidence ${confidence}, ${elapsed}ms`,
  )
  if (!pass) console.log(raw)
}

const mean = Math.round(latencyTotal / cases.length)
console.log(`model: ${model}`)
console.log(`correct: ${correct} of ${cases.length}`)
console.log(`mean latency: ${mean}ms`)
if (correct !== cases.length) process.exit(1)
