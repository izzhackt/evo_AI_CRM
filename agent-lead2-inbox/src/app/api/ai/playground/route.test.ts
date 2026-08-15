import { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  requireRole: vi.fn(),
  checkRateLimit: vi.fn(),
  retrieveKnowledgeWithEvidence: vi.fn(),
  generateReply: vi.fn(),
  loadConfig: vi.fn(),
  audit: vi.fn(),
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: h.requireRole,
  toErrorResponse: vi.fn((error: unknown) =>
    NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unauthorized' },
      { status: 500 }
    )
  ),
}))
vi.mock('@/lib/rate-limit', () => ({
  RATE_LIMITS: { aiDraft: {} },
  checkRateLimit: h.checkRateLimit,
  rateLimitResponse: vi.fn(),
}))
vi.mock('@/lib/ai/config', () => ({ loadAiConfigForAccount: h.loadConfig }))
vi.mock('@/lib/ai/knowledge', () => ({
  retrieveKnowledgeWithEvidence: h.retrieveKnowledgeWithEvidence,
}))
vi.mock('@/lib/ai/generate', () => ({ generateReply: h.generateReply }))
vi.mock('@/lib/ai/defaults', () => ({ buildSystemPrompt: vi.fn() }))
vi.mock('@/lib/ai/assistant-audit', () => ({
  AssistantAuditError: class extends Error {},
  recordAssistantAudit: h.audit,
}))
vi.mock('@/lib/supabase/admin-client', () => ({
  supabaseAdminClient: vi.fn(() => ({ admin: true })),
}))

import { POST } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  h.requireRole.mockResolvedValue({
    supabase: {},
    accountId: 'acct-1',
    userId: 'user-1',
  })
  h.checkRateLimit.mockReturnValue({ success: true })
  h.loadConfig.mockResolvedValue({
    provider: 'gemini',
    model: 'gemini-3.5-flash',
    systemPrompt: null,
    isActive: true,
    autoReplyEnabled: false,
    autoReplyMaxPerConversation: 1,
    embeddingsProvider: 'gemini',
    embeddingsApiKey: 'key',
    apiKey: 'key',
  })
  h.retrieveKnowledgeWithEvidence.mockResolvedValue({
    excerpts: ['Документы Китая'],
    chunkIds: ['11111111-1111-4111-8111-111111111111'],
    sources: [
      {
        chunk_id: '11111111-1111-4111-8111-111111111111',
        source_path: 'Страны/Китай.md',
      },
    ],
  })
  h.generateReply.mockResolvedValue({
    text: 'Подготовьте документы.',
    handoff: false,
  })
  h.audit.mockResolvedValue('22222222-2222-4222-8222-222222222222')
})

describe('POST /api/ai/playground', () => {
  it('rejects attempts to select the internal knowledge audience', async () => {
    const response = await POST(
      new Request('http://localhost/api/ai/playground', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audience: 'internal',
          messages: [{ role: 'user', content: 'Вопрос' }],
        }),
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Некорректный запрос.',
      code: 'invalid_request',
    })
    expect(h.retrieveKnowledgeWithEvidence).not.toHaveBeenCalled()
    expect(h.generateReply).not.toHaveBeenCalled()
  })

  it('hard-codes client retrieval and returns source/audit identities', async () => {
    const response = await POST(
      new Request('http://localhost/api/ai/playground', {
        method: 'POST',
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Документы Китая?' }],
          evaluation_case_id: 'client_china_documents',
        }),
      })
    )
    expect(response.status).toBe(200)
    expect(h.retrieveKnowledgeWithEvidence).toHaveBeenCalledWith(
      {},
      'acct-1',
      'client',
      expect.any(Object),
      'Документы Китая?'
    )
    expect(h.audit).toHaveBeenCalledWith(
      { admin: true },
      expect.objectContaining({ audience: 'client', actorUserId: 'user-1' })
    )
    await expect(response.json()).resolves.toEqual({
      reply: 'Подготовьте документы.',
      handoff: false,
      sources: [
        {
          chunk_id: '11111111-1111-4111-8111-111111111111',
          source_path: 'Страны/Китай.md',
        },
      ],
      audit_id: '22222222-2222-4222-8222-222222222222',
    })
  })
})
