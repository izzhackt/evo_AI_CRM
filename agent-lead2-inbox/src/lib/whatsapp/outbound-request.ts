import type { MessageStatus, OutboundState } from '@/types';

export interface PendingTextSend {
  requestId: string;
  text: string;
  replyToId?: string;
  aiDraftId?: string;
}

export type PendingTextSendInput = Omit<PendingTextSend, 'requestId'>;

export interface ManualSendFailureState {
  status: MessageStatus;
  outbound_state: OutboundState | null;
}

export interface ManualSendSuccessState {
  status: MessageStatus;
  outbound_state: 'accepted';
  waha_message_id: string | null;
  waha_message_status: 'accepted' | 'accepted_without_id';
}

/**
 * Reuse one request UUID while the operator retries the same composed
 * message. A changed message, reply target, or AI-draft link is a new intent
 * and receives a new UUID.
 */
export function resolvePendingTextSend(
  pending: PendingTextSend | null,
  input: PendingTextSendInput,
  createId: () => string = () => crypto.randomUUID()
): PendingTextSend {
  if (
    pending &&
    pending.text === input.text &&
    pending.replyToId === input.replyToId &&
    pending.aiDraftId === input.aiDraftId
  ) {
    return pending;
  }

  return { requestId: createId(), ...input };
}

/**
 * Preserve the server's durable state when one exists. A response without an
 * outbox state failed locally before the provider outcome became ambiguous.
 */
export function resolveManualSendFailureState(
  outboundState: unknown
): ManualSendFailureState {
  switch (outboundState) {
    case 'queued':
      return { status: 'sending', outbound_state: 'queued' };
    case 'dispatching':
      return { status: 'failed', outbound_state: 'dispatching' };
    case 'unknown':
      return { status: 'failed', outbound_state: 'unknown' };
    case 'rejected':
      return { status: 'failed', outbound_state: 'rejected' };
    default:
      return { status: 'failed', outbound_state: null };
  }
}

export function resolveManualSendSuccessState(
  responseBody: unknown
): ManualSendSuccessState {
  const body =
    responseBody && typeof responseBody === 'object'
      ? (responseBody as Record<string, unknown>)
      : {};
  const providerId =
    typeof body.whatsapp_message_id === 'string' &&
    body.whatsapp_message_id.trim()
      ? body.whatsapp_message_id.trim()
      : null;
  const providerStatus =
    body.waha_message_status === 'accepted_without_id' || !providerId
      ? 'accepted_without_id'
      : 'accepted';

  return {
    status: 'sent',
    outbound_state: 'accepted',
    waha_message_id: providerId,
    waha_message_status: providerStatus,
  };
}
