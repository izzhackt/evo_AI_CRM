import { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  requireRole: vi.fn(),
  checkRateLimit: vi.fn(),
  ingestDocument: vi.fn(),
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
  RATE_LIMITS: { adminAction: {} },
  checkRateLimit: h.checkRateLimit,
  rateLimitResponse: vi.fn(),
}))
vi.mock('@/lib/ai/config', () => ({
  loadEmbeddingsConfigForAccount: vi.fn(),
}))
vi.mock('@/lib/ai/knowledge', () => ({
  ingestDocument: h.ingestDocument,
}))

import { POST } from './route'

beforeEach(() => {
  h.requireRole.mockResolvedValue({
    supabase: {},
    accountId: 'acct-1',
    userId: 'user-1',
  })
  h.checkRateLimit.mockReturnValue({ success: true })
})

describe('POST /api/ai/knowledge', () => {
  it('rejects attempts to create client-managed knowledge manually', async () => {
    const response = await POST(
      new Request('http://localhost/api/ai/knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audience: 'client',
          title: 'Подмена',
          content: 'Этот текст не должен публиковаться.',
        }),
      }),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'audience is controlled by the server',
    })
    expect(h.ingestDocument).not.toHaveBeenCalled()
  })
})
