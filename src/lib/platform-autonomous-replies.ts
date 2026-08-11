const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

const STAFF_STATE_KEYS = [
  "control_state",
  "control_version",
  "control_reason",
  "control_recorded_at",
  "decision_state",
  "decision_reason_code",
  "policy_version",
  "proposal_request_id",
  "source_message_id",
  "intent_id",
  "intent_state",
  "attempt_outcome",
  "communication_message_id",
  "ack_name",
  "decided_at",
  "attempted_at",
  "autonomous_authority",
] as const;

const CONTROL_RESULT_KEYS = [
  "organization_id",
  "conversation_id",
  "control_version",
  "control_state",
  "control_reason",
  "control_recorded_at",
  "autonomous_authority",
] as const;

export const PLATFORM_AUTONOMY_CONTROL_STATES = [
  "enabled",
  "paused",
  "staff_takeover",
  "opted_out",
] as const;

export const PLATFORM_AUTONOMY_STAFF_CONTROL_STATES = [
  "enabled",
  "paused",
  "staff_takeover",
] as const;

export const PLATFORM_AUTONOMOUS_REPLY_DECISION_STATES = [
  "blocked",
  "queued",
] as const;

export const PLATFORM_AUTONOMOUS_REPLY_INTENT_STATES = [
  "queued",
  "dispatching",
  "accepted",
  "rejected",
  "unknown",
  "manual_review",
] as const;

export const PLATFORM_AUTONOMOUS_REPLY_ATTEMPT_OUTCOMES = [
  "accepted",
  "rejected",
  "unknown",
  "blocked",
] as const;

export const PLATFORM_AUTONOMOUS_REPLY_ACK_NAMES = [
  "ERROR",
  "PENDING",
  "SERVER",
  "DEVICE",
  "READ",
  "PLAYED",
] as const;

export const PLATFORM_AUTONOMOUS_REPLY_BLOCK_REASONS = [
  "autonomy_paused",
  "staff_takeover",
  "staff_outbound_after_enable",
  "opted_out",
  "conversation_closed",
  "source_not_latest",
  "source_not_inbound",
  "source_unsupported",
  "outside_reply_window",
  "outside_business_hours",
  "proposal_unavailable",
  "proposal_not_ready",
  "unsupported_language",
  "unsupported_intent",
  "low_confidence",
  "risk_not_low",
  "handoff_required",
  "handoff_reason_present",
  "approved_evidence_missing",
  "session_unhealthy",
  "cooldown_active",
  "rolling_rate_exhausted",
  "consecutive_limit_reached",
  "binding_unavailable",
  "mutable_gate_blocked",
] as const;

export type PlatformAutonomyControlState =
  (typeof PLATFORM_AUTONOMY_CONTROL_STATES)[number];
export type PlatformAutonomyStaffControlState =
  (typeof PLATFORM_AUTONOMY_STAFF_CONTROL_STATES)[number];
export type PlatformAutonomousReplyDecisionState =
  (typeof PLATFORM_AUTONOMOUS_REPLY_DECISION_STATES)[number];
export type PlatformAutonomousReplyIntentState =
  (typeof PLATFORM_AUTONOMOUS_REPLY_INTENT_STATES)[number];
export type PlatformAutonomousReplyAttemptOutcome =
  (typeof PLATFORM_AUTONOMOUS_REPLY_ATTEMPT_OUTCOMES)[number];
export type PlatformAutonomousReplyAckName =
  (typeof PLATFORM_AUTONOMOUS_REPLY_ACK_NAMES)[number];
export type PlatformAutonomousReplyBlockReason =
  (typeof PLATFORM_AUTONOMOUS_REPLY_BLOCK_REASONS)[number];

export type PlatformAutonomousReplyState = Readonly<{
  controlState: PlatformAutonomyControlState;
  controlVersion: string;
  controlReason: string;
  controlRecordedAt: string | null;
  decisionState: PlatformAutonomousReplyDecisionState | null;
  decisionReasonCode: PlatformAutonomousReplyBlockReason | null;
  policyVersion: "p5f3-v1" | null;
  proposalRequestId: string | null;
  sourceMessageId: string | null;
  intentId: string | null;
  intentState: PlatformAutonomousReplyIntentState | null;
  attemptOutcome: PlatformAutonomousReplyAttemptOutcome | null;
  communicationMessageId: string | null;
  ackName: PlatformAutonomousReplyAckName | null;
  decidedAt: string | null;
  attemptedAt: string | null;
  autonomousAuthority: boolean;
}>;

export type PlatformAutonomyControlResult = Readonly<{
  organizationId: string;
  conversationId: string;
  controlVersion: string;
  controlState: PlatformAutonomyStaffControlState;
  controlReason: string;
  controlRecordedAt: string;
  autonomousAuthority: boolean;
}>;

export class PlatformAutonomousReplyContractError extends Error {
  constructor() {
    super("Platform autonomous reply contract is invalid.");
    this.name = "PlatformAutonomousReplyContractError";
  }
}

function invalidShape(): never {
  throw new PlatformAutonomousReplyContractError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function parseUuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) invalidShape();
  const normalized = value.toLowerCase();
  if (normalized === NIL_UUID) invalidShape();
  return normalized;
}

function parseOptionalUuid(value: unknown): string | null {
  return value === null ? null : parseUuid(value);
}

function parseVersion(value: unknown): string {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) invalidShape();
    return String(value);
  }
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(value)) {
    invalidShape();
  }
  return value;
}

function parseText(value: unknown, maxLength: number): string {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    value.length < 1 ||
    value.length > maxLength
  ) {
    invalidShape();
  }
  return value;
}

function parseTimestamp(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) invalidShape();
  return value;
}

function parseOptionalTimestamp(value: unknown): string | null {
  return value === null ? null : parseTimestamp(value);
}

function parseEnum<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
): T[number] {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    invalidShape();
  }
  return value as T[number];
}

function parseOptionalEnum<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
): T[number] | null {
  return value === null ? null : parseEnum(value, allowed);
}

export function normalizePlatformAutonomousReplyState(
  value: unknown,
): PlatformAutonomousReplyState {
  if (!isRecord(value) || !hasExactKeys(value, STAFF_STATE_KEYS)) invalidShape();
  if (typeof value.autonomous_authority !== "boolean") invalidShape();

  return {
    controlState: parseEnum(value.control_state, PLATFORM_AUTONOMY_CONTROL_STATES),
    controlVersion: parseVersion(value.control_version),
    controlReason: parseText(value.control_reason, 500),
    controlRecordedAt: parseOptionalTimestamp(value.control_recorded_at),
    decisionState: parseOptionalEnum(
      value.decision_state,
      PLATFORM_AUTONOMOUS_REPLY_DECISION_STATES,
    ),
    decisionReasonCode: parseOptionalEnum(
      value.decision_reason_code,
      PLATFORM_AUTONOMOUS_REPLY_BLOCK_REASONS,
    ),
    policyVersion:
      value.policy_version === null
        ? null
        : parseEnum(value.policy_version, ["p5f3-v1"] as const),
    proposalRequestId: parseOptionalUuid(value.proposal_request_id),
    sourceMessageId: parseOptionalUuid(value.source_message_id),
    intentId: parseOptionalUuid(value.intent_id),
    intentState: parseOptionalEnum(
      value.intent_state,
      PLATFORM_AUTONOMOUS_REPLY_INTENT_STATES,
    ),
    attemptOutcome: parseOptionalEnum(
      value.attempt_outcome,
      PLATFORM_AUTONOMOUS_REPLY_ATTEMPT_OUTCOMES,
    ),
    communicationMessageId: parseOptionalUuid(value.communication_message_id),
    ackName: parseOptionalEnum(value.ack_name, PLATFORM_AUTONOMOUS_REPLY_ACK_NAMES),
    decidedAt: parseOptionalTimestamp(value.decided_at),
    attemptedAt: parseOptionalTimestamp(value.attempted_at),
    autonomousAuthority: value.autonomous_authority,
  };
}

export function normalizePlatformAutonomyControlResult(
  value: unknown,
): PlatformAutonomyControlResult {
  if (!isRecord(value) || !hasExactKeys(value, CONTROL_RESULT_KEYS)) invalidShape();
  if (typeof value.autonomous_authority !== "boolean") invalidShape();

  return {
    organizationId: parseUuid(value.organization_id),
    conversationId: parseUuid(value.conversation_id),
    controlVersion: parseVersion(value.control_version),
    controlState: parseEnum(
      value.control_state,
      PLATFORM_AUTONOMY_STAFF_CONTROL_STATES,
    ),
    controlReason: parseText(value.control_reason, 500),
    controlRecordedAt: parseTimestamp(value.control_recorded_at),
    autonomousAuthority: value.autonomous_authority,
  };
}

export function buildPlatformAutonomousReplyStateRpcArgs(input: {
  organizationId: string;
  conversationId: string;
}) {
  return {
    p_organization_id: parseUuid(input.organizationId),
    p_conversation_id: parseUuid(input.conversationId),
  };
}

export function buildPlatformAutonomyControlRpcArgs(input: {
  organizationId: string;
  conversationId: string;
  expectedVersion: string;
  state: PlatformAutonomyStaffControlState;
  reason: string;
  requestId: string;
}) {
  return {
    p_organization_id: parseUuid(input.organizationId),
    p_conversation_id: parseUuid(input.conversationId),
    p_expected_version: parseVersion(input.expectedVersion),
    p_state: parseEnum(input.state, PLATFORM_AUTONOMY_STAFF_CONTROL_STATES),
    p_reason: parseText(input.reason, 500),
    p_request_id: parseUuid(input.requestId),
  };
}
