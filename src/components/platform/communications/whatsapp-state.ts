export type OperationalTone = "neutral" | "info" | "ok" | "warning" | "danger";

export type DeliveryPresentation = {
  labelKey:
    | "providerDeliveryReceived"
    | "providerDeliverySent"
    | "providerDeliveryDelivered"
    | "providerDeliveryRead"
    | "providerDeliveryFailed"
    | "providerDeliveryUnknown";
  state: "received" | "sent" | "delivered" | "read" | "failed" | "unknown";
};

export type ConversationStatePresentation = {
  labelKey:
    | "agentStateModeDisabled"
    | "agentStateAutoreplyDisabled"
    | "agentStateHandoffRequired"
    | "agentStateReplyNotSent"
    | "agentStateReplySent"
    | "agentStateRecorded";
  nextActionKey:
    | "agentNextManualReply"
    | "agentNextReviewDraft"
    | "agentNextReviewHandoff"
    | "agentNextPrepareReply"
    | "agentNextVerifyDelivery"
    | "agentNextVerifyInAmo";
  tone: OperationalTone;
};

const CONVERSATION_STATES: Record<string, ConversationStatePresentation> = {
  agent_mode_disabled: {
    labelKey: "agentStateModeDisabled",
    nextActionKey: "agentNextManualReply",
    tone: "warning",
  },
  autoreply_disabled: {
    labelKey: "agentStateAutoreplyDisabled",
    nextActionKey: "agentNextReviewDraft",
    tone: "info",
  },
  handoff_required: {
    labelKey: "agentStateHandoffRequired",
    nextActionKey: "agentNextReviewHandoff",
    tone: "warning",
  },
  reply_not_sent: {
    labelKey: "agentStateReplyNotSent",
    nextActionKey: "agentNextPrepareReply",
    tone: "danger",
  },
  reply_sent: {
    labelKey: "agentStateReplySent",
    nextActionKey: "agentNextVerifyDelivery",
    tone: "ok",
  },
};

const HANDOFF_REASONS: Record<string, string> = {
  agent_mode_disabled: "handoffReasonAgentModeDisabled",
  autoreply_disabled: "handoffReasonAutoreplyDisabled",
  gemini_not_configured: "handoffReasonAiNotConfigured",
  operator_takeover: "handoffReasonOperatorTakeover",
};

function normalized(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

export function getDeliveryPresentation(
  direction: string,
  status: string | null | undefined,
): DeliveryPresentation {
  if (normalized(direction) === "in") {
    return { labelKey: "providerDeliveryReceived", state: "received" };
  }

  switch (normalized(status)) {
    case "sent":
      return { labelKey: "providerDeliverySent", state: "sent" };
    case "delivered":
      return { labelKey: "providerDeliveryDelivered", state: "delivered" };
    case "read":
      return { labelKey: "providerDeliveryRead", state: "read" };
    case "failed":
      return { labelKey: "providerDeliveryFailed", state: "failed" };
    default:
      return { labelKey: "providerDeliveryUnknown", state: "unknown" };
  }
}

export function getConversationStatePresentation(
  state: string | null | undefined,
): ConversationStatePresentation | null {
  const value = normalized(state);
  if (!value) return null;
  return (
    CONVERSATION_STATES[value] ?? {
      labelKey: "agentStateRecorded",
      nextActionKey: "agentNextVerifyInAmo",
      tone: "neutral",
    }
  );
}

export function getHandoffReasonLabelKey(reason: string | null | undefined) {
  const value = normalized(reason);
  return value ? HANDOFF_REASONS[value] ?? null : null;
}
