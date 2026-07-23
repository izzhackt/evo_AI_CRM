import { describe, expect, it, vi } from 'vitest';

import {
  WahaConfigurationError,
  buildWahaSendTextPayload,
  getWahaMessageById,
  normalizeWahaBaseUrl,
  parseWahaMessageAck,
  parseWahaSessionStatus,
  sendWahaText,
  toWahaChatId,
} from './client';

const wahaApiKeyFixture = ['test', 'api', 'key'].join('-');

describe('WAHA client', () => {
  it('normalizes direct WhatsApp chat ids for WAHA', () => {
    expect(toWahaChatId('+1 (415) 555-1212')).toBe('14155551212@c.us');
    expect(toWahaChatId('14155551212@c.us')).toBe('14155551212@c.us');
    expect(toWahaChatId('14155551212@s.whatsapp.net')).toBe('14155551212@c.us');
  });

  it('builds the documented sendText payload shape', () => {
    expect(
      buildWahaSendTextPayload({
        sessionName: 'evo-inbox',
        to: '+1 (415) 555-1212',
        text: 'Hello',
        replyTo: 'false_14155551212@c.us_PARENT',
      })
    ).toEqual({
      session: 'evo-inbox',
      chatId: '14155551212@c.us',
      text: 'Hello',
      reply_to: 'false_14155551212@c.us_PARENT',
    });
  });

  it('sends text through POST /api/sendText with X-Api-Key', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ id: 'false_14155551212@c.us_AAA' }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        })
    );

    const result = await sendWahaText(
      {
        baseUrl: 'https://waha.internal/',
        sessionName: 'evo-inbox',
        apiKey: wahaApiKeyFixture,
      },
      {
        to: '+1 (415) 555-1212',
        text: 'Hello',
      },
      fetchMock
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'https://waha.internal/api/sendText',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-Api-Key': wahaApiKeyFixture,
        }),
        body: JSON.stringify({
          session: 'evo-inbox',
          chatId: '14155551212@c.us',
          text: 'Hello',
        }),
      })
    );
    expect(result.whatsappMessageId).toBe('false_14155551212@c.us_AAA');
    expect(result.messageStatus).toBe('accepted');
  });

  it('reports accepted_without_id when WAHA accepts but returns no provider id', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
    );

    const result = await sendWahaText(
      {
        baseUrl: 'https://waha.internal/',
        sessionName: 'evo-inbox',
        apiKey: wahaApiKeyFixture,
      },
      {
        to: '+1 (415) 555-1212',
        text: 'Hello',
      },
      fetchMock
    );

    expect(result.whatsappMessageId).toBe('');
    expect(result.messageStatus).toBe('accepted_without_id');
  });

  it('reports exact missing WAHA configuration inputs', async () => {
    await expect(
      sendWahaText(
        { baseUrl: '', sessionName: '', apiKey: '' },
        { to: '+14155551212', text: 'Hello' },
        vi.fn()
      )
    ).rejects.toMatchObject({
      code: 'waha_not_configured',
      missingFields: ['baseUrl', 'sessionName', 'apiKey'],
    } satisfies Partial<WahaConfigurationError>);
  });

  it('normalizes base URLs and parses WAHA session status', () => {
    expect(normalizeWahaBaseUrl('https://waha.internal///')).toBe(
      'https://waha.internal'
    );
    expect(
      parseWahaSessionStatus({ name: 'evo-inbox', status: 'WORKING' })
    ).toMatchObject({ status: 'WORKING', ready: true });
    expect(
      parseWahaSessionStatus({ name: 'evo-inbox', status: 'FAILED' })
    ).toMatchObject({ status: 'FAILED', ready: false });
  });

  it('reads one provider message by its documented encoded WEBJS path', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: 'true_14155551212@c.us_AAA',
            ack: 3,
            ackName: 'READ',
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }
        )
    );

    const result = await getWahaMessageById(
      {
        baseUrl: 'https://waha.internal/',
        sessionName: 'evo-inbox',
        apiKey: wahaApiKeyFixture,
      },
      {
        chatId: '14155551212@c.us',
        messageId: 'true_14155551212@c.us_AAA',
      },
      fetchMock
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'https://waha.internal/api/evo-inbox/chats/14155551212%40c.us/messages/true_14155551212%40c.us_AAA?downloadMedia=false',
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'X-Api-Key': wahaApiKeyFixture,
        },
        signal: expect.any(AbortSignal),
      }
    );
    expect(result).toMatchObject({
      messageId: 'true_14155551212@c.us_AAA',
      chatId: '14155551212@c.us',
      ack: 3,
      ackName: 'READ',
    });
  });

  it('keeps unsupported or missing provider-message lookups unresolved', async () => {
    const notFound = vi.fn(async () => new Response(null, { status: 404 }));

    await expect(
      getWahaMessageById(
        {
          baseUrl: 'https://waha.internal',
          sessionName: 'evo-inbox',
          apiKey: wahaApiKeyFixture,
        },
        {
          chatId: '14155551212@c.us',
          messageId: 'true_14155551212@c.us_MISSING',
        },
        notFound
      )
    ).resolves.toBeNull();
  });

  it('accepts only documented acknowledgement pairs from message lookup', () => {
    expect(parseWahaMessageAck({ ack: 2, ackName: 'device' })).toEqual({
      ack: 2,
      ackName: 'DEVICE',
    });
    expect(parseWahaMessageAck({ ack: 2, ackName: 'READ' })).toEqual({
      ack: null,
      ackName: null,
    });
    expect(parseWahaMessageAck({ ack: 9, ackName: 'UNKNOWN' })).toEqual({
      ack: null,
      ackName: null,
    });
  });
});
