import { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  requireRole: vi.fn(),
  checkRateLimit: vi.fn(),
  revokeAccountApiKey: vi.fn(),
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
  RATE_LIMITS: { adminAction: {} },
  checkRateLimit: h.checkRateLimit,
  rateLimitResponse: vi.fn(() =>
    NextResponse.json({ error: 'rate_limited' }, { status: 429 }),
  ),
}))

vi.mock('@/lib/api-keys/admin-store', () => ({
  revokeAccountApiKey: h.revokeAccountApiKey,
}))

import { DELETE } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  h.checkRateLimit.mockReturnValue({ success: true })
})

describe('DELETE /api/account/api-keys/[id]', () => {
  it('revokes only within the resolved account through the admin store', async () => {
    h.requireRole.mockResolvedValue({ accountId: 'acct-1', userId: 'user-1' })
    h.revokeAccountApiKey.mockResolvedValue({
      data: { id: 'key-1' },
      error: null,
    })

    const response = await DELETE(new Request('http://localhost'), {
      params: Promise.resolve({ id: 'key-1' }),
    })

    expect(response.status).toBe(200)
    expect(h.revokeAccountApiKey).toHaveBeenCalledWith('acct-1', 'key-1')
    await expect(response.json()).resolves.toEqual({ success: true })
  })
})
