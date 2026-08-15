import { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  requireRole: vi.fn(),
  retrieve: vi.fn(),
  loadConfig: vi.fn(),
  generate: vi.fn(),
  audit: vi.fn(),
  checkRateLimit: vi.fn(),
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: h.requireRole,
  toErrorResponse: vi.fn((error: Error) =>
    NextResponse.json({ error: error.message, code: 'error' }, { status: 500 })
  ),
}))
vi.mock('@/lib/ai/knowledge', () => ({
  retrieveKnowledgeWithEvidence: h.retrieve,
}))
vi.mock('@/lib/ai/config', () => ({ loadAiConfigForAccount: h.loadConfig }))
vi.mock('@/lib/ai/generate', () => ({ generateReply: h.generate }))
vi.mock('@/lib/ai/defaults', () => ({
  buildSystemPrompt: vi.fn(() => 'system'),
}))
vi.mock('@/lib/ai/assistant-audit', () => ({
  AssistantAuditError: class extends Error {
    code = 'assistant_audit_failed'
    status = 502
    constructor() {
      super('Черновик создан, но безопасный аудит не сохранился.')
    }
  },
  recordAssistantAudit: h.audit,
}))
vi.mock('@/lib/supabase/admin-client', () => ({
  supabaseAdminClient: vi.fn(() => ({ admin: true })),
}))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: h.checkRateLimit,
  rateLimitResponse: vi.fn(),
  RATE_LIMITS: { aiDraft: {} },
}))

import { AssistantAuditError } from '@/lib/ai/assistant-audit'
import { POST } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  h.requireRole.mockResolvedValue({
    supabase: {},
    accountId: 'acct',
    userId: 'user',
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
  h.retrieve.mockResolvedValue({
    excerpts: ['Передать кейс в ОЗО.'],
    chunkIds: ['11111111-1111-4111-8111-111111111111'],
    sources: [
      {
        chunk_id: '11111111-1111-4111-8111-111111111111',
        source_path: 'Процессы/Передача.md',
      },
    ],
  })
  h.generate.mockResolvedValue({
    text: 'Передайте кейс сотруднику ОЗО.',
    handoff: true,
  })
  h.audit.mockResolvedValue('22222222-2222-4222-8222-222222222222')
})

describe('POST /api/ai/internal-assistant', () => {
  it('hard-codes internal retrieval and returns body-free audit identity', async () => {
    const response = await POST(
      new Request('http://localhost/api/ai/internal-assistant', {
        method: 'POST',
        body: JSON.stringify({
          message: 'Как передать студента?',
          evaluation_case_id: 'internal_malaysia_handoff',
        }),
      })
    )
    expect(response.status).toBe(200)
    expect(h.retrieve).toHaveBeenCalledWith(
      {},
      'acct',
      'internal',
      expect.any(Object),
      'Как передать студента?'
    )
    expect(h.audit).toHaveBeenCalledWith(
      { admin: true },
      expect.objectContaining({ audience: 'internal', actorUserId: 'user' })
    )
    await expect(response.json()).resolves.toEqual({
      reply: 'Передайте кейс сотруднику ОЗО.',
      handoff: true,
      sources: [
        {
          chunk_id: '11111111-1111-4111-8111-111111111111',
          source_path: 'Процессы/Передача.md',
        },
      ],
      audit_id: '22222222-2222-4222-8222-222222222222',
    })
  })

  it('rejects audience injection before retrieval', async () => {
    const response = await POST(
      new Request('http://localhost/api/ai/internal-assistant', {
        method: 'POST',
        body: JSON.stringify({ message: 'Вопрос', audience: 'client' }),
      })
    )
    expect(response.status).toBe(400)
    expect(h.retrieve).not.toHaveBeenCalled()
  })

  it('does not return generated text when immutable audit insert fails', async () => {
    h.audit.mockRejectedValue(new AssistantAuditError())
    const response = await POST(
      new Request('http://localhost/api/ai/internal-assistant', {
        method: 'POST',
        body: JSON.stringify({ message: 'Как передать студента?' }),
      })
    )
    expect(response.status).toBe(502)
    const body = await response.json()
    expect(body).toEqual({
      error: 'Черновик создан, но безопасный аудит не сохранился.',
      code: 'assistant_audit_failed',
    })
    expect(body).not.toHaveProperty('reply')
  })
})
