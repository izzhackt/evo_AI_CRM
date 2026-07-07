import { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AiError, type AiConfig } from '@/lib/ai/types'

const h = vi.hoisted(() => ({
  requireRole: vi.fn(),
  checkRateLimit: vi.fn(),
  loadAiConfig: vi.fn(),
  buildConversationContext: vi.fn(),
  retrieveKnowledge: vi.fn(),
  buildSystemPrompt: vi.fn(),
  generateReply: vi.fn(),
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: h.requireRole,
  toErrorResponse: vi.fn((err: unknown) =>
    NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unauthorized' },
      { status: 500 },
    ),
  ),
}))

vi.mock('@/lib/rate-limit', () => ({
  RATE_LIMITS: { aiDraft: {}, aiDraftAccount: {} },
  checkRateLimit: h.checkRateLimit,
  rateLimitResponse: vi.fn(() =>
    NextResponse.json({ error: 'rate_limited' }, { status: 429 }),
  ),
}))

vi.mock('@/lib/ai/config', () => ({ loadAiConfig: h.loadAiConfig }))
vi.mock('@/lib/ai/context', () => ({
  buildConversationContext: h.buildConversationContext,
}))
vi.mock('@/lib/ai/knowledge', () => ({ retrieveKnowledge: h.retrieveKnowledge }))
vi.mock('@/lib/ai/defaults', () => ({ buildSystemPrompt: h.buildSystemPrompt }))
vi.mock('@/lib/ai/generate', () => ({ generateReply: h.generateReply }))

import { POST } from './route'

function aiConfig(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    provider: 'openai',
    model: 'gpt-test',
    apiKey: 'sk-test',
    systemPrompt: 'Use EVO admissions tone.',
    isActive: true,
    autoReplyEnabled: false,
    autoReplyMaxPerConversation: 1,
    embeddingsApiKey: null,
    ...overrides,
  }
}

function request(body: unknown): Request {
  return new Request('http://localhost/api/ai/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function supabaseForConversation(row: { id: string } | null) {
  const chain = {
    from: vi.fn(() => chain),
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn(() => Promise.resolve({ data: row, error: null })),
  }
  return chain
}

beforeEach(() => {
  h.checkRateLimit.mockReturnValue({ success: true })
  h.loadAiConfig.mockResolvedValue(aiConfig())
  h.buildConversationContext.mockResolvedValue([
    { role: 'user', content: 'Do you help with universities in Italy?' },
  ])
  h.retrieveKnowledge.mockResolvedValue([])
  h.buildSystemPrompt.mockReturnValue('system prompt')
  h.generateReply.mockResolvedValue({ text: 'Yes, we can help.', handoff: false })

  h.requireRole.mockResolvedValue({
    supabase: supabaseForConversation({ id: 'conv-1' }),
    accountId: 'acct-1',
    userId: 'user-1',
  })
})

describe('POST /api/ai/draft', () => {
  it('returns an explicit missing-config error before generating', async () => {
    h.loadAiConfig.mockResolvedValue(null)

    const response = await POST(request({ conversation_id: 'conv-1' }))
    const json = await response.json()

    expect(response.status).toBe(400)
    expect(json).toEqual({
      error: 'AI assistant is not set up. Enable it in Settings → AI Assistant.',
      code: 'ai_not_configured',
    })
    expect(h.buildConversationContext).not.toHaveBeenCalled()
    expect(h.retrieveKnowledge).not.toHaveBeenCalled()
    expect(h.generateReply).not.toHaveBeenCalled()
  })

  it('grounds a draft reply in retrieved knowledge', async () => {
    h.retrieveKnowledge.mockResolvedValue([
      'EVO supports applications to universities in Italy and scholarship review.',
    ])
    h.buildSystemPrompt.mockReturnValue('system prompt with knowledge')

    const response = await POST(request({ conversation_id: 'conv-1' }))
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json).toEqual({ draft: 'Yes, we can help.' })
    expect(h.retrieveKnowledge).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      expect.objectContaining({ provider: 'openai' }),
      'Do you help with universities in Italy?',
    )
    expect(h.buildSystemPrompt).toHaveBeenCalledWith({
      userPrompt: 'Use EVO admissions tone.',
      mode: 'draft',
      knowledge: [
        'EVO supports applications to universities in Italy and scholarship review.',
      ],
    })
    expect(h.generateReply).toHaveBeenCalledWith({
      config: expect.objectContaining({ provider: 'openai' }),
      systemPrompt: 'system prompt with knowledge',
      messages: [{ role: 'user', content: 'Do you help with universities in Italy?' }],
    })
  })

  it('surfaces provider failures without pretending a draft exists', async () => {
    h.generateReply.mockRejectedValue(
      new AiError('OpenAI rejected the request.', {
        code: 'provider_error',
        status: 502,
      }),
    )

    const response = await POST(request({ conversation_id: 'conv-1' }))
    const json = await response.json()

    expect(response.status).toBe(502)
    expect(json).toEqual({
      error: 'OpenAI rejected the request.',
      code: 'provider_error',
    })
  })
})
