import { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AiError, type AiConfig } from '@/lib/ai/types'

const h = vi.hoisted(() => ({
  requireRole: vi.fn(),
  checkRateLimit: vi.fn(),
  integrationsAdminClient: vi.fn(),
  loadAiConfigForAccount: vi.fn(),
  buildConversationContext: vi.fn(),
  retrieveKnowledgeWithEvidence: vi.fn(),
  recordAiDraftAudit: vi.fn(),
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
  rateLimitResponse: vi.fn(() => NextResponse.json({ error: 'rate_limited' }, { status: 429 })),
}))

vi.mock('@/lib/ai/config', () => ({
  loadAiConfigForAccount: h.loadAiConfigForAccount,
}))
vi.mock('@/lib/ai/context', () => ({
  buildConversationContext: h.buildConversationContext,
}))
vi.mock('@/lib/integrations/admin-client', () => ({
  integrationsAdminClient: h.integrationsAdminClient,
}))
vi.mock('@/lib/ai/knowledge', () => ({
  retrieveKnowledgeWithEvidence: h.retrieveKnowledgeWithEvidence,
}))
vi.mock('@/lib/ai/draft-audit', () => ({
  recordAiDraftAudit: h.recordAiDraftAudit,
}))
vi.mock('@/lib/ai/defaults', () => ({
  buildSystemPrompt: h.buildSystemPrompt,
}))
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
    embeddingsProvider: 'keyword',
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
  h.loadAiConfigForAccount.mockResolvedValue(aiConfig())
  h.buildConversationContext.mockResolvedValue([
    { role: 'user', content: 'Do you help with universities in Italy?' },
  ])
  h.retrieveKnowledgeWithEvidence.mockResolvedValue({
    excerpts: [],
    chunkIds: [],
  })
  h.integrationsAdminClient.mockReturnValue({ kind: 'service-role-db' })
  h.recordAiDraftAudit.mockResolvedValue('draft-1')
  h.buildSystemPrompt.mockReturnValue('system prompt')
  h.generateReply.mockResolvedValue({
    text: 'Yes, we can help.',
    handoff: false,
  })

  h.requireRole.mockResolvedValue({
    supabase: supabaseForConversation({ id: 'conv-1' }),
    accountId: 'acct-1',
    userId: 'user-1',
  })
})

describe('POST /api/ai/draft', () => {
  it('rejects attempts to select the internal knowledge audience', async () => {
    const response = await POST(request({ conversation_id: 'conv-1', audience: 'internal' }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'audience is controlled by the server',
    })
    expect(h.retrieveKnowledgeWithEvidence).not.toHaveBeenCalled()
    expect(h.generateReply).not.toHaveBeenCalled()
  })

  it('returns an explicit missing-config error before generating', async () => {
    h.loadAiConfigForAccount.mockResolvedValue(null)

    const response = await POST(request({ conversation_id: 'conv-1' }))
    const json = await response.json()

    expect(response.status).toBe(400)
    expect(json).toEqual({
      error: 'AI assistant is not set up. Enable it in Settings → AI Assistant.',
      code: 'ai_not_configured',
    })
    expect(h.buildConversationContext).not.toHaveBeenCalled()
    expect(h.retrieveKnowledgeWithEvidence).not.toHaveBeenCalled()
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.recordAiDraftAudit).not.toHaveBeenCalled()
  })

  it('grounds and audits a draft reply before returning it', async () => {
    h.retrieveKnowledgeWithEvidence.mockResolvedValue({
      excerpts: ['EVO supports applications to universities in Italy and scholarship review.'],
      chunkIds: ['chunk-1'],
    })
    h.buildSystemPrompt.mockReturnValue('system prompt with knowledge')

    const response = await POST(request({ conversation_id: 'conv-1' }))
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json).toEqual({
      draft: 'Yes, we can help.',
      draft_id: 'draft-1',
    })
    expect(h.retrieveKnowledgeWithEvidence).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      'client',
      expect.objectContaining({ provider: 'openai' }),
      'Do you help with universities in Italy?',
    )
    expect(h.buildSystemPrompt).toHaveBeenCalledWith({
      userPrompt: 'Use EVO admissions tone.',
      mode: 'draft',
      knowledge: ['EVO supports applications to universities in Italy and scholarship review.'],
    })
    expect(h.generateReply).toHaveBeenCalledWith({
      config: expect.objectContaining({ provider: 'openai' }),
      systemPrompt: 'system prompt with knowledge',
      messages: [{ role: 'user', content: 'Do you help with universities in Italy?' }],
    })
    expect(h.recordAiDraftAudit).toHaveBeenCalledWith(
      { kind: 'service-role-db' },
      {
        accountId: 'acct-1',
        conversationId: 'conv-1',
        createdBy: 'user-1',
        provider: 'openai',
        model: 'gpt-test',
        contentText: 'Yes, we can help.',
        knowledgeChunkIds: ['chunk-1'],
      },
    )
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
    expect(h.recordAiDraftAudit).not.toHaveBeenCalled()
  })

  it('fails closed when the generated draft cannot be audited', async () => {
    h.recordAiDraftAudit.mockRejectedValue(new Error('audit insert failed'))

    const response = await POST(request({ conversation_id: 'conv-1' }))
    const json = await response.json()

    expect(response.status).toBe(503)
    expect(json).toEqual({
      error: 'The AI draft could not be saved for operator review. Please try again.',
      code: 'ai_draft_audit_failed',
    })
  })
})
