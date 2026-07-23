import { describe, expect, it, vi } from 'vitest';

import {
  resolveManualSendFailureState,
  resolveManualSendSuccessState,
  resolvePendingTextSend,
} from './outbound-request';

describe('resolvePendingTextSend', () => {
  it('reuses the same UUID for a retry of the same operator intent', () => {
    const createId = vi.fn(() => 'new-id');
    const pending = {
      requestId: 'original-id',
      text: 'Hello',
      replyToId: 'message-1',
      aiDraftId: 'draft-1',
    };

    expect(
      resolvePendingTextSend(
        pending,
        {
          text: 'Hello',
          replyToId: 'message-1',
          aiDraftId: 'draft-1',
        },
        createId
      )
    ).toBe(pending);
    expect(createId).not.toHaveBeenCalled();
  });

  it('creates a new UUID when the text or audit linkage changes', () => {
    const createId = vi.fn(() => 'new-id');

    expect(
      resolvePendingTextSend(
        {
          requestId: 'original-id',
          text: 'Hello',
          aiDraftId: 'draft-1',
        },
        {
          text: 'Hello, edited',
          aiDraftId: 'draft-1',
        },
        createId
      )
    ).toEqual({
      requestId: 'new-id',
      text: 'Hello, edited',
      aiDraftId: 'draft-1',
    });
  });
});

describe('resolveManualSendFailureState', () => {
  it('keeps a pre-provider failure visibly queued for a safe retry', () => {
    expect(resolveManualSendFailureState('queued')).toEqual({
      status: 'sending',
      outbound_state: 'queued',
    });
  });

  it('keeps ambiguous and confirmed-rejection states distinct', () => {
    expect(resolveManualSendFailureState('unknown')).toEqual({
      status: 'failed',
      outbound_state: 'unknown',
    });
    expect(resolveManualSendFailureState('rejected')).toEqual({
      status: 'failed',
      outbound_state: 'rejected',
    });
  });

  it('uses a local failure state when no durable provider state exists', () => {
    expect(resolveManualSendFailureState(undefined)).toEqual({
      status: 'failed',
      outbound_state: null,
    });
  });
});

describe('resolveManualSendSuccessState', () => {
  it('keeps the stable provider id for normal accepted sends', () => {
    expect(
      resolveManualSendSuccessState({
        whatsapp_message_id: 'provider-message-1',
        waha_message_status: 'accepted',
      })
    ).toEqual({
      status: 'sent',
      outbound_state: 'accepted',
      waha_message_id: 'provider-message-1',
      waha_message_status: 'accepted',
    });
  });

  it('marks an accepted send without a provider id for operator review', () => {
    expect(
      resolveManualSendSuccessState({
        whatsapp_message_id: '',
        waha_message_status: 'accepted_without_id',
      })
    ).toEqual({
      status: 'sent',
      outbound_state: 'accepted',
      waha_message_id: null,
      waha_message_status: 'accepted_without_id',
    });
  });
});
