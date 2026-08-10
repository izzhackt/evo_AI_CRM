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

export type WahaAckPresentation = {
  labelKey:
    | "platformWahaAckError"
    | "platformWahaAckPending"
    | "platformWahaAckServer"
    | "platformWahaAckDevice"
    | "platformWahaAckRead"
    | "platformWahaAckPlayed"
    | "platformWahaAckUnknown";
  tone: OperationalTone;
};

export type WahaSessionHealthPresentation = {
  labelKey:
    | "platformWahaSessionWorking"
    | "platformWahaSessionTransitioning"
    | "platformWahaSessionUnhealthy"
    | "platformWahaSessionUnknown";
  tone: OperationalTone;
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

export function getWahaAckPresentation(
  ackName: string | null | undefined,
): WahaAckPresentation {
  switch (ackName) {
    case "ERROR":
      return { labelKey: "platformWahaAckError", tone: "danger" };
    case "PENDING":
      return { labelKey: "platformWahaAckPending", tone: "warning" };
    case "SERVER":
      return { labelKey: "platformWahaAckServer", tone: "info" };
    case "DEVICE":
      return { labelKey: "platformWahaAckDevice", tone: "ok" };
    case "READ":
      return { labelKey: "platformWahaAckRead", tone: "ok" };
    case "PLAYED":
      return { labelKey: "platformWahaAckPlayed", tone: "ok" };
    default:
      return { labelKey: "platformWahaAckUnknown", tone: "warning" };
  }
}

const TRANSITIONAL_WAHA_SESSION_STATUSES = new Set([
  "STARTING",
  "CONNECTING",
  "PAIRING",
  "SCAN_QR_CODE",
  "RECONNECTING",
  "SYNCING",
]);

export function getWahaSessionHealthPresentation(
  status: string | null | undefined,
): WahaSessionHealthPresentation {
  if (status === "WORKING") {
    return { labelKey: "platformWahaSessionWorking", tone: "ok" };
  }
  if (status === "STOPPED" || status === "FAILED") {
    return { labelKey: "platformWahaSessionUnhealthy", tone: "danger" };
  }
  if (status && TRANSITIONAL_WAHA_SESSION_STATUSES.has(status)) {
    return { labelKey: "platformWahaSessionTransitioning", tone: "warning" };
  }
  return { labelKey: "platformWahaSessionUnknown", tone: "danger" };
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
