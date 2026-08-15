import { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  requireRole: vi.fn(),
  checkRateLimit: vi.fn(),
  retrieveKnowledge: vi.fn(),
  generateReply: vi.fn(),
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: h.requireRole,
  toErrorResponse: vi.fn((error: unknown) =>
    NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unauthorized' },
      { status: 500 },
    ),
  ),
}))
vi.mock('@/lib/rate-limit', () => ({
  RATE_LIMITS: { aiDraft: {} },
  checkRateLimit: h.checkRateLimit,
  rateLimitResponse: vi.fn(),
}))
vi.mock('@/lib/ai/config', () => ({ loadAiConfigForAccount: vi.fn() }))
vi.mock('@/lib/ai/knowledge', () => ({
  retrieveKnowledge: h.retrieveKnowledge,
}))
vi.mock('@/lib/ai/generate', () => ({ generateReply: h.generateReply }))
vi.mock('@/lib/ai/defaults', () => ({ buildSystemPrompt: vi.fn() }))

import { POST } from './route'

beforeEach(() => {
  h.requireRole.mockResolvedValue({
    supabase: {},
    accountId: 'acct-1',
    userId: 'user-1',
  })
  h.checkRateLimit.mockReturnValue({ success: true })
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
      }),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'audience is controlled by the server',
    })
    expect(h.retrieveKnowledge).not.toHaveBeenCalled()
    expect(h.generateReply).not.toHaveBeenCalled()
  })
})
