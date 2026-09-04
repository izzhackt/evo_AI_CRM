"use server";

import { createHash } from "node:crypto";

import { revalidatePath } from "next/cache";

import { getPlatformConversationThread } from "./platform-communications";
import { requirePlatformMessagingActor } from "./platform-guards";
import {
  parsePlatformAiFactValue,
  PLATFORM_AI_CONTROL_STATES,
  PLATFORM_AI_FACT_KEYS,
  PLATFORM_AI_QUALIFICATION_STATES,
  PlatformAiMemoryContractError,
  type PlatformAiControlState,
  type PlatformAiFactKey,
  type PlatformAiQualificationState,
} from "./platform-ai-memory";
import {
  previewPlatformApprovedKnowledgeLexical,
  readPlatformConversationAiMemory,
  recordPlatformConversationAiFact,
  recordPlatformConversationAiMemory,
  recordPlatformConversationAiQualification,
  setPlatformConversationAiControl,
} from "./server/platform-ai-memory-repository";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

function field(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  return typeof value === "string" ? value : null;
}

function canonicalUuid(value: unknown): string | null {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) return null;
  const normalized = value.toLowerCase();
  return normalized === NIL_UUID ? null : normalized;
}

function conversationId(formData: FormData) {
  return canonicalUuid(field(formData, "conversationId"));
}

function safeText(value: unknown, maxLength: number, optional = false) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (optional && normalized.length === 0) return "";
  return normalized.length >= 1 && normalized.length <= maxLength
    ? normalized
    : null;
}

function semanticRequestId(
  organizationId: string,
  membershipId: string,
  operation: string,
  parts: readonly unknown[],
) {
  const digest = createHash("sha256")
    .update(
      JSON.stringify([
        "evo-platform-ai-memory-v1",
        organizationId,
        membershipId,
        operation,
        ...parts,
      ]),
      "utf8",
    )
    .digest("hex");
  const variant = ((Number.parseInt(digest[16], 16) & 0x3) | 0x8).toString(16);
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `5${digest.slice(13, 16)}`,
    `${variant}${digest.slice(17, 20)}`,
    digest.slice(20, 32),
  ].join("-");
}

async function latestInboundMessageId(
  actor: Awaited<ReturnType<typeof requirePlatformMessagingActor>>,
  id: string,
) {
  const thread = await getPlatformConversationThread(actor, id);
  const latest = thread
    ? [...thread.messages]
        .reverse()
        .find((message) => message.direction === "inbound")
    : null;
  if (!latest) throw new PlatformAiMemoryContractError();
  return latest.id;
}

async function selectedInboundMessageId(
  actor: Awaited<ReturnType<typeof requirePlatformMessagingActor>>,
  id: string,
  selectedId: string,
) {
  const canonicalSelectedId = canonicalUuid(selectedId);
  if (!canonicalSelectedId) throw new PlatformAiMemoryContractError();
  const thread = await getPlatformConversationThread(actor, id);
  const selected = thread?.messages.find(
    (message) =>
      message.id === canonicalSelectedId && message.direction === "inbound",
  );
  if (!selected) throw new PlatformAiMemoryContractError();
  return selected.id;
}

function refreshInbox() {
  revalidatePath("/v3/inbox");
}

export async function recordPlatformAiMemoryAction(
  formData: FormData,
): Promise<void> {
  const id = conversationId(formData);
  const shortSummary = safeText(field(formData, "shortSummary"), 1_000);
  const longSummary = safeText(field(formData, "longSummary"), 6_000);
  const selectedSourceMessageId = field(formData, "sourceMessageId");
  if (!id || !shortSummary || !longSummary || !selectedSourceMessageId) return;

  try {
    const actor = await requirePlatformMessagingActor();
    const [current, sourceMessageId] = await Promise.all([
      readPlatformConversationAiMemory(actor, id),
      selectedInboundMessageId(actor, id, selectedSourceMessageId),
    ]);
    await recordPlatformConversationAiMemory(actor, {
      conversationId: id,
      expectedVersion: current.memory.version,
      shortSummary,
      longSummary,
      sourceMessageId,
      reason: "staff_ui_update",
      requestId: semanticRequestId(
        actor.organizationId,
        actor.membershipId,
        "memory",
        [id, current.memory.version, shortSummary, longSummary, sourceMessageId],
      ),
    });
    refreshInbox();
  } catch {
    return;
  }
}

export async function recordPlatformAiFactAction(
  formData: FormData,
): Promise<void> {
  const id = conversationId(formData);
  const rawKey = field(formData, "factKey");
  const rawStatus = field(formData, "factStatus");
  const selectedSourceMessageId = field(formData, "sourceMessageId");
  if (
    !id ||
    !rawKey ||
    !selectedSourceMessageId ||
    !(PLATFORM_AI_FACT_KEYS as readonly string[]).includes(rawKey) ||
    (rawStatus !== "active" && rawStatus !== "retracted")
  ) {
    return;
  }
  const key = rawKey as PlatformAiFactKey;
  const value =
    rawStatus === "retracted"
      ? null
      : parsePlatformAiFactValue(key, field(formData, "factValue"));
  if (rawStatus === "active" && value === null) return;

  try {
    const actor = await requirePlatformMessagingActor();
    const [current, sourceMessageId] = await Promise.all([
      readPlatformConversationAiMemory(actor, id),
      selectedInboundMessageId(actor, id, selectedSourceMessageId),
    ]);
    const currentFact = current.facts.find((fact) => fact.key === key);
    const expectedVersion = currentFact?.version ?? "0";
    await recordPlatformConversationAiFact(actor, {
      conversationId: id,
      key,
      expectedVersion,
      status: rawStatus,
      value,
      sourceMessageId,
      reason: "staff_ui_update",
      requestId: semanticRequestId(
        actor.organizationId,
        actor.membershipId,
        "fact",
        [id, key, expectedVersion, rawStatus, value, sourceMessageId],
      ),
    });
    refreshInbox();
  } catch {
    return;
  }
}

export async function recordPlatformAiQualificationAction(
  formData: FormData,
): Promise<void> {
  const id = conversationId(formData);
  const rawStatus = field(formData, "qualificationStatus");
  const rawCompleteness = field(formData, "completeness");
  const selectedSourceMessageId = field(formData, "sourceMessageId");
  const completeness = rawCompleteness === null ? Number.NaN : Number(rawCompleteness);
  const rawMissingKeys = formData
    .getAll("missingFactKeys")
    .filter((value): value is string => typeof value === "string");
  if (
    !id ||
    !rawStatus ||
    !selectedSourceMessageId ||
    !(PLATFORM_AI_QUALIFICATION_STATES as readonly string[]).includes(rawStatus) ||
    !Number.isInteger(completeness) ||
    completeness < 0 ||
    completeness > 100 ||
    rawMissingKeys.some(
      (key) => !(PLATFORM_AI_FACT_KEYS as readonly string[]).includes(key),
    ) ||
    new Set(rawMissingKeys).size !== rawMissingKeys.length
  ) {
    return;
  }
  const status = rawStatus as PlatformAiQualificationState;
  const missingFactKeys = rawMissingKeys as PlatformAiFactKey[];
  if (status === "staff_confirmed" && (completeness !== 100 || missingFactKeys.length)) {
    return;
  }
  const notesValue = safeText(field(formData, "qualificationNotes"), 2_000, true);
  if (notesValue === null) return;
  const notes = notesValue.length ? notesValue : null;

  try {
    const actor = await requirePlatformMessagingActor();
    const [current, sourceMessageId] = await Promise.all([
      readPlatformConversationAiMemory(actor, id),
      selectedInboundMessageId(actor, id, selectedSourceMessageId),
    ]);
    await recordPlatformConversationAiQualification(actor, {
      conversationId: id,
      expectedVersion: current.qualification.version,
      status,
      completeness,
      missingFactKeys,
      notes,
      sourceMessageId,
      reason: "staff_ui_update",
      requestId: semanticRequestId(
        actor.organizationId,
        actor.membershipId,
        "qualification",
        [
          id,
          current.qualification.version,
          status,
          completeness,
          missingFactKeys,
          notes,
          sourceMessageId,
        ],
      ),
    });
    refreshInbox();
  } catch {
    return;
  }
}

export async function setPlatformAiControlAction(
  formData: FormData,
): Promise<void> {
  const id = conversationId(formData);
  const rawState = field(formData, "controlState");
  if (
    !id ||
    !rawState ||
    !(PLATFORM_AI_CONTROL_STATES as readonly string[]).includes(rawState)
  ) {
    return;
  }
  const state = rawState as PlatformAiControlState;

  try {
    const actor = await requirePlatformMessagingActor();
    const current = await readPlatformConversationAiMemory(actor, id);
    const reason =
      state === "paused"
        ? "staff_ui_pause"
        : state === "staff_takeover"
          ? "staff_ui_takeover"
          : "staff_ui_staff_only";
    await setPlatformConversationAiControl(actor, {
      conversationId: id,
      expectedVersion: current.control.version,
      state,
      reason,
      requestId: semanticRequestId(
        actor.organizationId,
        actor.membershipId,
        "control",
        [id, current.control.version, state],
      ),
    });
    refreshInbox();
  } catch {
    return;
  }
}

export async function previewPlatformAiLexicalAction(
  formData: FormData,
): Promise<void> {
  const id = conversationId(formData);
  if (!id) return;

  try {
    const actor = await requirePlatformMessagingActor();
    const [current, sourceMessageId] = await Promise.all([
      readPlatformConversationAiMemory(actor, id),
      latestInboundMessageId(actor, id),
    ]);
    await previewPlatformApprovedKnowledgeLexical(actor, {
      conversationId: id,
      sourceMessageId,
      limit: 5,
      reason: "staff_ui_preview",
      requestId: semanticRequestId(
        actor.organizationId,
        actor.membershipId,
        "lexical_preview",
        [id, sourceMessageId, current.latestRetrieval?.requestId ?? "none"],
      ),
    });
    refreshInbox();
  } catch {
    return;
  }
}
