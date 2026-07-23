import { describe, expect, it } from 'vitest'

import { buildSystemPrompt } from './defaults'

describe('buildSystemPrompt', () => {
  it('restricts draft language selection to Kyrgyz, Russian, or English', () => {
    const prompt = buildSystemPrompt({
      userPrompt: null,
      mode: 'draft',
    })

    expect(prompt).toContain('customers write in Kyrgyz, Russian, or English')
    expect(prompt).toContain('reply only in that language')
    expect(prompt).toContain(
      'ask one short clarification question in English instead of guessing'
    )
  })

  it('keeps editable business behaviour inside the system prompt', () => {
    const prompt = buildSystemPrompt({
      userPrompt: 'EVO starts with a free consultation.',
      mode: 'draft',
    })

    expect(prompt).toContain('Business context and instructions:')
    expect(prompt).toContain('EVO starts with a free consultation.')
  })
})
