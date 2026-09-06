"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { fixedRoleCan } from "./fixed-role-policy.ts";
import { requirePlatformStaffActor } from "./platform-guards.ts";
import {
  attachPlatformMessageMediaToCase,
  type PlatformMediaAttachFailureCode,
} from "./server/platform-media-attach.ts";
import { exactActionStringFields } from "./server/action-form-fields.ts";

const ATTACH_MEDIA_FIELDS = [
  "conversation_id",
  "communication_media_id",
  "student_case_id",
  "document_slot_id",
  "request_id",
] as const;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type PlatformMediaAttachActionStatus =
  | "idle"
  | "attached"
  | PlatformMediaAttachFailureCode;

export type PlatformMediaAttachActionState = Readonly<{
  status: PlatformMediaAttachActionStatus;
  requestId: string;
  documentVersionId: string | null;
}>;

export const PLATFORM_MEDIA_ATTACH_INITIAL_ACTION_STATE:
PlatformMediaAttachActionState = Object.freeze({
  status: "idle",
  requestId: "",
  documentVersionId: null,
});

function uuid(value: string | undefined): string | null {
  return value && value === value.toLowerCase() && UUID_PATTERN.test(value)
    ? value
    : null;
}

function submittedRequestId(form: FormData): string | null {
  for (const [rawKey, value] of form.entries()) {
    const key = rawKey.startsWith("_1_") ? rawKey.slice(3) : rawKey;
    if (key === "request_id" && typeof value === "string") {
      return uuid(value);
    }
  }
  return null;
}

function failureState(
  form: FormData,
  status: PlatformMediaAttachFailureCode,
): PlatformMediaAttachActionState {
  const requestId = submittedRequestId(form);
  return Object.freeze({
    status,
    requestId: status === "request_conflict"
      ? randomUUID()
      : (requestId ?? randomUUID()),
    documentVersionId: null,
  });
}

/**
 * React 19 useActionState adapter for D2. Only resource identifiers enter via
 * FormData. Organization, user, membership and authority are resolved from the
 * authenticated server session and then rechecked by migration 121.
 */
export async function attachPlatformMessageMediaToCaseAction(
  _previous: PlatformMediaAttachActionState,
  form: FormData,
): Promise<PlatformMediaAttachActionState> {
  const actor = await requirePlatformStaffActor();
  if (
    !fixedRoleCan(actor.authorityRole, "documents.write")
    || !fixedRoleCan(actor.authorityRole, "messaging.read")
  ) {
    return failureState(form, "forbidden");
  }

  const fields = exactActionStringFields(form, ATTACH_MEDIA_FIELDS);
  if (!fields) return failureState(form, "invalid");
  const conversationId = uuid(fields.get("conversation_id"));
  const communicationMediaId = uuid(fields.get("communication_media_id"));
  const studentCaseId = uuid(fields.get("student_case_id"));
  const documentSlotId = uuid(fields.get("document_slot_id"));
  const requestId = uuid(fields.get("request_id"));
  if (
    !conversationId
    || !communicationMediaId
    || !studentCaseId
    || !documentSlotId
    || !requestId
  ) {
    return failureState(form, "invalid");
  }

  const result = await attachPlatformMessageMediaToCase(actor, {
    conversationId,
    communicationMediaId,
    studentCaseId,
    documentSlotId,
    requestId,
  });
  if (result.status === "failed") {
    return failureState(form, result.code);
  }

  revalidatePath("/v3/inbox");
  revalidatePath("/v3/profile");
  return Object.freeze({
    status: "attached" as const,
    requestId: randomUUID(),
    documentVersionId: result.documentVersionId,
  });
}
