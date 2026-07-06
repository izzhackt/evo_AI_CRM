import { describe, expect, it, vi } from 'vitest';

import {
  WahaConfigurationError,
  buildWahaSendTextPayload,
  normalizeWahaBaseUrl,
  parseWahaSessionStatus,
  sendWahaText,
  toWahaChatId,
} from './client';

describe('WAHA client', () => {
  it('normalizes direct WhatsApp chat ids for WAHA', () => {
    expect(toWahaChatId('+1 (415) 555-1212')).toBe('14155551212@c.us');
    expect(toWahaChatId('14155551212@c.us')).toBe('14155551212@c.us');
  });

  it('builds the documented sendText payload shape', () => {
    expect(
      buildWahaSendTextPayload({
        sessionName: 'evo-inbox',
        to: '+1 (415) 555-1212',
        text: 'Hello',
      }),
    ).toEqual({
      session: 'evo-inbox',
      chatId: '14155551212@c.us',
      text: 'Hello',
    });
  });

  it('sends text through POST /api/sendText with X-Api-Key', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ id: 'false_14155551212@c.us_AAA' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const result = await sendWahaText(
      {
        baseUrl: 'https://waha.internal/',
        sessionName: 'evo-inbox',
        apiKey: 'test-api-key',
      },
      {
        to: '+1 (415) 555-1212',
        text: 'Hello',
      },
      fetchMock,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'https://waha.internal/api/sendText',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-Api-Key': 'test-api-key',
        }),
        body: JSON.stringify({
          session: 'evo-inbox',
          chatId: '14155551212@c.us',
          text: 'Hello',
        }),
      }),
    );
    expect(result.whatsappMessageId).toBe('false_14155551212@c.us_AAA');
  });

  it('reports exact missing WAHA configuration inputs', async () => {
    await expect(
      sendWahaText(
        { baseUrl: '', sessionName: '', apiKey: '' },
        { to: '+14155551212', text: 'Hello' },
        vi.fn(),
      ),
    ).rejects.toMatchObject({
      code: 'waha_not_configured',
      missingFields: ['baseUrl', 'sessionName', 'apiKey'],
    } satisfies Partial<WahaConfigurationError>);
  });

  it('normalizes base URLs and parses WAHA session status', () => {
    expect(normalizeWahaBaseUrl('https://waha.internal///')).toBe(
      'https://waha.internal',
    );
    expect(parseWahaSessionStatus({ name: 'evo-inbox', status: 'WORKING' }))
      .toMatchObject({ status: 'WORKING', ready: true });
    expect(parseWahaSessionStatus({ name: 'evo-inbox', status: 'FAILED' }))
      .toMatchObject({ status: 'FAILED', ready: false });
  });
});
