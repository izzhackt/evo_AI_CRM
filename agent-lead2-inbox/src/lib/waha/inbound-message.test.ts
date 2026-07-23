import { describe, expect, it } from 'vitest';

import {
  WahaInboundMessageParseError,
  parseWahaInboundMessageEvent,
} from './inbound-message';

describe('WAHA inbound message parser', () => {
  it('parses a representative inbound WAHA message payload', () => {
    const result = parseWahaInboundMessageEvent({
      event: 'message',
      session: 'evo-inbox',
      engine: 'WEBJS',
      payload: {
        id: 'false_14155551212@c.us_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        timestamp: 1700000000,
        from: '14155551212@c.us',
        fromMe: false,
        to: '15551230000@c.us',
        body: 'Hello from WhatsApp',
        hasMedia: false,
        _data: {
          notifyName: 'Alice Applicant',
        },
      },
    });

    expect(result).toEqual({
      kind: 'message',
      message: {
        sessionName: 'evo-inbox',
        messageId: 'false_14155551212@c.us_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        chatId: '14155551212@c.us',
        senderPhone: '+14155551212',
        senderName: 'Alice Applicant',
        contentType: 'text',
        contentText: 'Hello from WhatsApp',
        media: null,
        receivedAt: '2023-11-14T22:13:20.000Z',
      },
    });
  });

  it('normalizes internal WhatsApp ids to the direct-chat phone identity', () => {
    const result = parseWahaInboundMessageEvent({
      event: 'message',
      session: 'evo-inbox',
      payload: {
        id: 'msg-1',
        timestamp: '1700000000000',
        from: '14155551212@s.whatsapp.net',
        body: 'Using internal id',
      },
    });

    expect(result.kind).toBe('message');
    if (result.kind === 'message') {
      expect(result.message.chatId).toBe('14155551212@c.us');
      expect(result.message.senderPhone).toBe('+14155551212');
      expect(result.message.receivedAt).toBe('2023-11-14T22:13:20.000Z');
    }
  });

  it('extracts the authenticated WAHA media descriptor without exposing bytes', () => {
    const result = parseWahaInboundMessageEvent({
      event: 'message',
      session: 'evo-inbox',
      payload: {
        id: 'media-1',
        timestamp: 1700000000,
        from: '14155551212@c.us',
        hasMedia: true,
        media: {
          url: 'http://evo-inbox-waha:3000/api/files/media-1.pdf',
          mimetype: 'application/pdf',
          filename: 'admission.pdf',
        },
      },
    });

    expect(result.kind).toBe('message');
    if (result.kind === 'message') {
      expect(result.message.contentType).toBe('document');
      expect(result.message.media).toEqual({
        url: 'http://evo-inbox-waha:3000/api/files/media-1.pdf',
        mimetype: 'application/pdf',
        filename: 'admission.pdf',
      });
    }
  });

  it('ignores outbound/from-me messages before local persistence', () => {
    expect(
      parseWahaInboundMessageEvent({
        event: 'message',
        session: 'evo-inbox',
        payload: {
          id: 'msg-outbound',
          timestamp: 1700000000,
          from: '14155551212@c.us',
          fromMe: true,
          body: 'Sent by us',
        },
      }),
    ).toEqual({ kind: 'ignored', reason: 'from_me' });
  });

  it('ignores group/channel/status chats because they are not real lead phones', () => {
    expect(
      parseWahaInboundMessageEvent({
        event: 'message',
        session: 'evo-inbox',
        payload: {
          id: 'msg-group',
          timestamp: 1700000000,
          from: '120363000000000000@g.us',
          body: 'Group message',
        },
      }),
    ).toEqual({ kind: 'ignored', reason: 'unsupported_chat' });
  });

  it('fails malformed message events with a typed parse error', () => {
    expect(() =>
      parseWahaInboundMessageEvent({
        event: 'message',
        session: 'evo-inbox',
        payload: {
          timestamp: 1700000000,
          from: '14155551212@c.us',
          body: 'Missing id',
        },
      }),
    ).toThrow(WahaInboundMessageParseError);

    try {
      parseWahaInboundMessageEvent({
        event: 'message',
        session: 'evo-inbox',
        payload: {
          id: 'msg-1',
          timestamp: 1700000000,
          body: 'Missing sender',
        },
      });
    } catch (err) {
      expect(err).toMatchObject({
        code: 'waha_message_malformed',
        missingFields: ['from'],
      });
    }
  });
});
