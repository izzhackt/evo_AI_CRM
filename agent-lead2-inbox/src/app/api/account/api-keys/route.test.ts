import { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
  requireRole: vi.fn(),
  checkRateLimit: vi.fn(),
  generateApiKey: vi.fn(),
  listAccountApiKeys: vi.fn(),
  createAccountApiKey: vi.fn(),
}))

vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: h.getCurrentAccount,
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

vi.mock('@/lib/api-keys/keys', () => ({
  generateApiKey: h.generateApiKey,
}))

vi.mock('@/lib/api-keys/admin-store', () => ({
  createAccountApiKey: h.createAccountApiKey,
  listAccountApiKeys: h.listAccountApiKeys,
}))

import { GET, POST } from './route'

function request(body: unknown): Request {
  return new Request('http://localhost/api/account/api-keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.checkRateLimit.mockReturnValue({ success: true })
  h.generateApiKey.mockReturnValue({
    plaintext: 'evoinbox_live_secret',
    hash: 'hash-123',
    prefix: 'evoinbox_live_abcd',
  })
})

describe('account api-keys route', () => {
  it('lists only safe columns through the admin store after account resolution', async () => {
    h.getCurrentAccount.mockResolvedValue({ accountId: 'acct-1' })
    h.listAccountApiKeys.mockResolvedValue({
      data: [{ id: 'key-1', name: 'Primary', key_prefix: 'evoinbox_live_abcd' }],
      error: null,
    })

    const response = await GET()

    expect(response.status).toBe(200)
    expect(h.listAccountApiKeys).toHaveBeenCalledWith('acct-1')
    await expect(response.json()).resolves.toEqual({
      keys: [{ id: 'key-1', name: 'Primary', key_prefix: 'evoinbox_live_abcd' }],
    })
  })

  it('creates a key through the admin store and returns plaintext once', async () => {
    h.requireRole.mockResolvedValue({ accountId: 'acct-1', userId: 'user-1' })
    h.createAccountApiKey.mockResolvedValue({
      data: { id: 'key-1', name: 'Primary', key_prefix: 'evoinbox_live_abcd' },
      error: null,
    })

    const response = await POST(
      request({ name: 'Primary', scopes: ['contacts:read'], expiresInDays: 30 }),
    )

    expect(response.status).toBe(201)
    expect(h.createAccountApiKey).toHaveBeenCalledWith({
      accountId: 'acct-1',
      userId: 'user-1',
      name: 'Primary',
      keyPrefix: 'evoinbox_live_abcd',
      keyHash: 'hash-123',
      scopes: ['contacts:read'],
      expiresAt: expect.any(String),
    })
    await expect(response.json()).resolves.toEqual({
      key: { id: 'key-1', name: 'Primary', key_prefix: 'evoinbox_live_abcd' },
      plaintext: 'evoinbox_live_secret',
    })
  })
})
