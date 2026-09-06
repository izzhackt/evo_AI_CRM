"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { fixedRoleCan } from "./fixed-role-policy";
import type { PlatformAdmissionsActionStatus } from "./platform-admissions-task-actions";
import { requirePlatformStaffActor } from "./platform-guards";
import {
  isPlatformReplySnippetAudience,
  PLATFORM_REPLY_SNIPPET_BODY_MAX_LENGTH,
  PLATFORM_REPLY_SNIPPET_TITLE_MAX_LENGTH,
} from "./platform-reply-snippets";
import { exactActionStringFields } from "./server/action-form-fields";
import { createSupabaseServerClient } from "./supabase/server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TIMESTAMPTZ_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const POSITIVE_BIGINT_PATTERN = /^[1-9]\d*$/;
const SINGLE_LINE_CONTROL_PATTERN = /[\u0000-\u001F\u007F]/;
const BODY_CONTROL_PATTERN = /[\u0000-\u0009\u000B-\u001F\u007F]/;

const CREATE_SNIPPET_FIELDS = [
  "audience",
  "title",
  "body",
  "request_id",
] as const;
const UPDATE_SNIPPET_FIELDS = [
  "reply_snippet_id",
  "audience",
  "title",
  "body",
  "expected_version",
  "request_id",
] as const;
const ARCHIVE_SNIPPET_FIELDS = [
  "reply_snippet_id",
  "expected_version",
  "request_id",
] as const;

export type PlatformReplySnippetActionState = Readonly<{
  status: PlatformAdmissionsActionStatus;
  requestId: string;
  replySnippetId: string | null;
  version: string | null;
  archivedAt: string | null;
}>;

type Fields = ReadonlyMap<string, string>;

function field(fields: Fields, key: string): string {
  return fields.get(key)?.trim() ?? "";
}

function uuid(value: unknown): string | null {
  return typeof value === "string" && UUID_PATTERN.test(value)
    ? value.toLowerCase()
    : null;
}

function version(value: unknown): string | null {
  return typeof value === "string" && POSITIVE_BIGINT_PATTERN.test(value)
    ? value
    : null;
}

function timestamp(value: unknown): string | null {
  return typeof value === "string" && TIMESTAMPTZ_PATTERN.test(value)
    ? value
    : null;
}

function audienceValue(value: string): string | null {
  return isPlatformReplySnippetAudience(value) ? value : null;
}

function titleValue(value: string): string | null {
  const normalized = value.trim();
  return normalized.length >= 1 &&
      normalized.length <= PLATFORM_REPLY_SNIPPET_TITLE_MAX_LENGTH &&
      !SINGLE_LINE_CONTROL_PATTERN.test(normalized)
    ? normalized
    : null;
}

/** Browsers submit textarea newlines as CRLF; the model stores LF only. */
function bodyValue(value: string): string | null {
  const normalized = value.replace(/\r\n?/g, "\n").trim();
  return normalized.length >= 1 &&
      normalized.length <= PLATFORM_REPLY_SNIPPET_BODY_MAX_LENGTH &&
      !BODY_CONTROL_PATTERN.test(normalized)
    ? normalized
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
}

function errorStatus(error: unknown): Exclude<
  PlatformAdmissionsActionStatus,
  "idle" | "saved"
> {
  if (!isRecord(error)) return "unavailable";
  const code = typeof error.code === "string" ? error.code : "";
  const message = typeof error.message === "string" ? error.message : "";
  if (code === "42501") return "forbidden";
  if (
    code === "40001" ||
    (code === "PT409" && /changed|version_conflict/i.test(message))
  ) {
    return "stale";
  }
  if ((code === "22023" || code === "23505") && /request_id/i.test(message)) {
    return "request_conflict";
  }
  if (code === "22023") return "invalid";
  return "unavailable";
}

function submittedRequestId(form: FormData): string | null {
  const direct = form.getAll("request_id");
  const enveloped = form.getAll("_1_request_id");
  const values = direct.length > 0 ? direct : enveloped;
  const candidate = values.length === 1 ? values[0] : null;
  return uuid(candidate);
}

function failureState(
  form: FormData,
  status: Exclude<PlatformAdmissionsActionStatus, "idle" | "saved">,
  replySnippetId: string | null = null,
  verifiedRequestId?: string | null,
): PlatformReplySnippetActionState {
  const requestId = verifiedRequestId ?? submittedRequestId(form);
  return Object.freeze({
    status,
    requestId: status === "request_conflict"
      ? randomUUID()
      : (requestId ?? randomUUID()),
    replySnippetId,
    version: null,
    archivedAt: null,
  });
}

function successState(
  replySnippetId: string,
  versionValue: string,
  archivedAt: string | null,
): PlatformReplySnippetActionState {
  revalidatePath("/v3/inbox");
  return Object.freeze({
    status: "saved",
    requestId: randomUUID(),
    replySnippetId,
    version: versionValue,
    archivedAt,
  });
}

const CREATE_RESULT_KEYS = [
  "organization_id",
  "audience",
  "title",
  "body",
  "request_id",
  "reply_snippet_id",
  "version",
  "archived_at",
  "created_at",
  "updated_at",
] as const;

const MUTATE_RESULT_KEYS = [
  "organization_id",
  "reply_snippet_id",
  "audience",
  "title",
  "body",
  "request_id",
  "expected_version",
  "version",
  "archived_at",
  "created_at",
  "updated_at",
] as const;

function verifiedSnippetResult(
  value: unknown,
  keys: readonly string[],
  expected: Readonly<{
    organizationId: string;
    requestId: string;
    replySnippetId?: string;
    audience?: string;
    title?: string;
    body?: string;
    previousVersion?: string;
    archived: boolean;
  }>,
): Readonly<{
  replySnippetId: string;
  version: string;
  archivedAt: string | null;
}> | null {
  if (!isRecord(value) || !hasExactKeys(value, keys)) return null;
  const organizationId = uuid(value.organization_id);
  const replySnippetId = uuid(value.reply_snippet_id);
  const requestId = uuid(value.request_id);
  const nextVersion = version(value.version);
  const archivedAt = value.archived_at === null
    ? null
    : timestamp(value.archived_at);
  if (
    organizationId !== expected.organizationId || !replySnippetId ||
    requestId !== expected.requestId || !nextVersion ||
    (value.archived_at !== null && !archivedAt) ||
    (expected.replySnippetId !== undefined &&
      replySnippetId !== expected.replySnippetId) ||
    (expected.audience !== undefined && value.audience !== expected.audience) ||
    (expected.title !== undefined && value.title !== expected.title) ||
    (expected.body !== undefined && value.body !== expected.body) ||
    typeof value.audience !== "string" || !audienceValue(value.audience) ||
    typeof value.title !== "string" || !titleValue(value.title) ||
    typeof value.body !== "string" || !bodyValue(value.body) ||
    !timestamp(value.created_at) || !timestamp(value.updated_at) ||
    (expected.archived ? archivedAt === null : archivedAt !== null) ||
    (expected.previousVersion !== undefined &&
      BigInt(nextVersion) !== BigInt(expected.previousVersion) + BigInt(1))
  ) {
    return null;
  }
  return Object.freeze({ replySnippetId, version: nextVersion, archivedAt });
}

async function writableActor(form: FormData) {
  const actor = await requirePlatformStaffActor();
  if (!fixedRoleCan(actor.authorityRole, "messaging.send")) {
    return { actor: null, failure: failureState(form, "forbidden") } as const;
  }
  return { actor, failure: null } as const;
}

export async function createPlatformReplySnippetAction(
  _previous: PlatformReplySnippetActionState,
  form: FormData,
): Promise<PlatformReplySnippetActionState> {
  const authorization = await writableActor(form);
  if (!authorization.actor) return authorization.failure;
  const fields = exactActionStringFields(form, CREATE_SNIPPET_FIELDS);
  if (!fields) return failureState(form, "invalid");
  const audience = audienceValue(field(fields, "audience"));
  const title = titleValue(field(fields, "title"));
  const body = bodyValue(field(fields, "body"));
  const requestId = uuid(field(fields, "request_id"));
  if (!audience || !title || !body || !requestId) {
    return failureState(form, "invalid", null, requestId);
  }
  try {
    const client = await createSupabaseServerClient();
    const response = await client.schema("platform").rpc(
      "create_reply_snippet",
      {
        p_organization_id: authorization.actor.organizationId,
        p_audience: audience,
        p_title: title,
        p_body: body,
        p_request_id: requestId,
      },
    );
    if (response.error) {
      return failureState(form, errorStatus(response.error), null, requestId);
    }
    const result = verifiedSnippetResult(response.data, CREATE_RESULT_KEYS, {
      organizationId: authorization.actor.organizationId,
      requestId,
      audience,
      title,
      body,
      archived: false,
    });
    if (!result || result.version !== "1") {
      return failureState(form, "unavailable", null, requestId);
    }
    return successState(result.replySnippetId, result.version, null);
  } catch {
    return failureState(form, "unavailable", null, requestId);
  }
}

export async function updatePlatformReplySnippetAction(
  _previous: PlatformReplySnippetActionState,
  form: FormData,
): Promise<PlatformReplySnippetActionState> {
  const authorization = await writableActor(form);
  if (!authorization.actor) return authorization.failure;
  const fields = exactActionStringFields(form, UPDATE_SNIPPET_FIELDS);
  if (!fields) return failureState(form, "invalid");
  const replySnippetId = uuid(field(fields, "reply_snippet_id"));
  const audience = audienceValue(field(fields, "audience"));
  const title = titleValue(field(fields, "title"));
  const body = bodyValue(field(fields, "body"));
  const expectedVersion = version(field(fields, "expected_version"));
  const requestId = uuid(field(fields, "request_id"));
  if (
    !replySnippetId || !audience || !title || !body || !expectedVersion ||
    !requestId
  ) {
    return failureState(form, "invalid", replySnippetId, requestId);
  }
  try {
    const client = await createSupabaseServerClient();
    const response = await client.schema("platform").rpc(
      "update_reply_snippet",
      {
        p_organization_id: authorization.actor.organizationId,
        p_reply_snippet_id: replySnippetId,
        p_audience: audience,
        p_title: title,
        p_body: body,
        p_expected_version: expectedVersion,
        p_request_id: requestId,
      },
    );
    if (response.error) {
      return failureState(
        form,
        errorStatus(response.error),
        replySnippetId,
        requestId,
      );
    }
    const result = verifiedSnippetResult(response.data, MUTATE_RESULT_KEYS, {
      organizationId: authorization.actor.organizationId,
      requestId,
      replySnippetId,
      audience,
      title,
      body,
      previousVersion: expectedVersion,
      archived: false,
    });
    return result
      ? successState(replySnippetId, result.version, null)
      : failureState(form, "unavailable", replySnippetId, requestId);
  } catch {
    return failureState(form, "unavailable", replySnippetId, requestId);
  }
}

export async function archivePlatformReplySnippetAction(
  _previous: PlatformReplySnippetActionState,
  form: FormData,
): Promise<PlatformReplySnippetActionState> {
  const authorization = await writableActor(form);
  if (!authorization.actor) return authorization.failure;
  const fields = exactActionStringFields(form, ARCHIVE_SNIPPET_FIELDS);
  if (!fields) return failureState(form, "invalid");
  const replySnippetId = uuid(field(fields, "reply_snippet_id"));
  const expectedVersion = version(field(fields, "expected_version"));
  const requestId = uuid(field(fields, "request_id"));
  if (!replySnippetId || !expectedVersion || !requestId) {
    return failureState(form, "invalid", replySnippetId, requestId);
  }
  try {
    const client = await createSupabaseServerClient();
    const response = await client.schema("platform").rpc(
      "archive_reply_snippet",
      {
        p_organization_id: authorization.actor.organizationId,
        p_reply_snippet_id: replySnippetId,
        p_expected_version: expectedVersion,
        p_request_id: requestId,
      },
    );
    if (response.error) {
      return failureState(
        form,
        errorStatus(response.error),
        replySnippetId,
        requestId,
      );
    }
    const result = verifiedSnippetResult(response.data, MUTATE_RESULT_KEYS, {
      organizationId: authorization.actor.organizationId,
      requestId,
      replySnippetId,
      previousVersion: expectedVersion,
      archived: true,
    });
    return result
      ? successState(replySnippetId, result.version, result.archivedAt)
      : failureState(form, "unavailable", replySnippetId, requestId);
  } catch {
    return failureState(form, "unavailable", replySnippetId, requestId);
  }
}
