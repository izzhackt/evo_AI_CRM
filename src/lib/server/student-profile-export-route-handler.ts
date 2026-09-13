import "server-only";

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isStaffPreview, staffHasPermission } from "../platform-access.ts";
import type { PlatformActor, PlatformActorResult } from "../platform-auth.ts";
import {
  getPlatformStudentProfileFields,
  PlatformStudentProfileFieldsError,
  type PlatformStudentProfileFieldsSnapshot,
} from "../platform-student-profile-fields.ts";
import {
  getProfileExportValues,
  ProfileExportNotReadyError,
  type ProfileIssue,
} from "../student-profile-fields.ts";
import { getPlatformSupabaseBackendConfig } from "./platform-supabase-backend-config.ts";
import { createPlatformSupabaseServiceClient } from "./platform-supabase-service-client.ts";
import { renderStudentProfileTemplate, STUDENT_PROFILE_TEMPLATE_SHA256 } from "./student-profile-template.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 1024;
const MAX_OUTPUT_BYTES = 5 * 1024 * 1024;
const HEADERS = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };
const FAILURE_STATUS = {
  profile_not_ready: 422,
  profile_changed: 409,
  access_changed: 403,
  template_unavailable: 503,
  render_failed: 503,
  export_unavailable: 503,
} as const;
type FailureCode = keyof typeof FAILURE_STATUS;
type ExportCommand = Readonly<{ mode: "draft" | "final"; expectedRevision: number; requestId: string }>;
type Attempt = Readonly<{
  id: string;
  studentProfileId: string;
  status: "pending" | "generated" | "failed";
  created: boolean;
  failureCode: FailureCode | null;
}>;
type Completion = Readonly<{ status: "generated" | "failed"; failureCode: FailureCode | null }>;
type SafeIssue = Pick<ProfileIssue, "key" | "kind">;

export type StudentProfileExportDependencies = Readonly<{
  loadActor(): Promise<PlatformActorResult>;
  readSnapshot(actor: PlatformActor, studentCaseId: string): Promise<PlatformStudentProfileFieldsSnapshot>;
  createServiceClient(): Pick<SupabaseClient, "schema">;
  readTemplate(): Promise<Buffer>;
  render: typeof renderStudentProfileTemplate;
}>;

class ExportFailure extends Error {
  readonly code: FailureCode;
  readonly issues: readonly SafeIssue[] | undefined;
  constructor(code: FailureCode, issues?: readonly SafeIssue[]) {
    super(code);
    this.code = code;
    this.issues = issues;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return isRecord(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function isUuid(value: unknown): value is string { return typeof value === "string" && UUID.test(value); }
function isFailure(value: unknown): value is FailureCode { return typeof value === "string" && Object.hasOwn(FAILURE_STATUS, value); }

function errorResponse(status: number, error: string, issues?: readonly SafeIssue[]): Response {
  return Response.json({ error, ...(issues ? { issues } : {}) }, { status, headers: HEADERS });
}
function failedResponse(code: FailureCode, issues?: readonly SafeIssue[]): Response {
  return errorResponse(FAILURE_STATUS[code], code, issues);
}

/** Same Origin/Host/protocol convention as the existing platform-audit export. */
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    if (origin !== parsed.origin) return false;
    const host = request.headers.get("host")?.trim();
    if (!host || host.includes(",") || /\s/u.test(host) || parsed.host !== host.toLowerCase()) return false;
    const forwardedProto = request.headers.get("x-forwarded-proto")?.trim();
    if (forwardedProto !== undefined && !/^(?:http|https)$/u.test(forwardedProto)) return false;
    return parsed.protocol === (forwardedProto ? `${forwardedProto}:` : new URL(request.url).protocol);
  } catch { return false; }
}

async function readCommand(request: Request): Promise<ExportCommand | null> {
  if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers.get("content-type") ?? "")) return null;
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) return null;
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!exact(body, ["mode", "expected_revision", "request_id"])
      || (body.mode !== "draft" && body.mode !== "final")
      || typeof body.expected_revision !== "number" || !Number.isSafeInteger(body.expected_revision)
      || body.expected_revision < 1 || !isUuid(body.request_id)) return null;
    return { mode: body.mode, expectedRevision: body.expected_revision, requestId: body.request_id.toLowerCase() };
  } catch { return null; }
  finally { reader.releaseLock(); }
}

function normalizeAttempt(data: unknown, actor: PlatformActor, caseId: string, command: ExportCommand): Attempt {
  if (!exact(data, ["attempt_id", "organization_id", "student_case_id", "student_profile_id", "profile_revision",
    "mode", "template_sha256", "status", "created", "failure_code"])
    || !isUuid(data.attempt_id) || !isUuid(data.student_profile_id)
    || data.organization_id !== actor.organizationId || data.student_case_id !== caseId
    || data.profile_revision !== command.expectedRevision || data.mode !== command.mode
    || data.template_sha256 !== STUDENT_PROFILE_TEMPLATE_SHA256
    || (data.status !== "pending" && data.status !== "generated" && data.status !== "failed")
    || typeof data.created !== "boolean" || (data.created && data.status !== "pending")
    || (data.status === "failed" ? !isFailure(data.failure_code) : data.failure_code !== null)) {
    throw new ExportFailure("export_unavailable");
  }
  return { id: data.attempt_id, studentProfileId: data.student_profile_id, status: data.status,
    created: data.created, failureCode: data.failure_code as FailureCode | null };
}

function normalizeCompletion(data: unknown, attemptId: string, requested: "generated" | "failed"): Completion | null {
  if (!exact(data, ["attempt_id", "status", "failure_code"]) || data.attempt_id !== attemptId
    || (data.status !== "generated" && data.status !== "failed")
    || (requested === "failed" && data.status !== "failed")
    || (data.status === "failed" ? !isFailure(data.failure_code) : data.failure_code !== null)) return null;
  return { status: data.status, failureCode: data.failure_code as FailureCode | null };
}

function initialActorError(result: PlatformActorResult): Response | null {
  if (result.status === "anonymous") return errorResponse(401, "authentication_required");
  if (result.status === "invalid") return failedResponse("export_unavailable");
  if (isStaffPreview(result.actor) || !staffHasPermission(result.actor, "profile.read.full")
    || !staffHasPermission(result.actor, "document.download")) return errorResponse(403, "forbidden");
  return null;
}

const DEFAULT_DEPENDENCIES: StudentProfileExportDependencies = {
  loadActor: async () => {
    const { resolvePlatformActor } = await import("../platform-auth.ts");
    return resolvePlatformActor();
  },
  // The elevated client below is never a source of profile values.
  readSnapshot: getPlatformStudentProfileFields,
  createServiceClient: () => createPlatformSupabaseServiceClient(getPlatformSupabaseBackendConfig()),
  readTemplate: () => readFile(path.join(process.cwd(), "assets/templates/student-profile.docx")),
  render: renderStudentProfileTemplate,
};

export function createStudentProfileExportHandler(dependencies: StudentProfileExportDependencies = DEFAULT_DEPENDENCIES) {
  return async function POST(request: Request, context: { params: Promise<{ studentCaseId: string }> }): Promise<Response> {
    if (request.method !== "POST") return studentProfileExportMethodNotAllowed();
    if (!sameOrigin(request)) return errorResponse(403, "forbidden");
    let command: ExportCommand | null;
    let actor: PlatformActor;
    let caseId: string;
    let client: Pick<SupabaseClient, "schema">;
    let attempt: Attempt;
    try {
      const result = await dependencies.loadActor();
      const denied = initialActorError(result);
      if (denied) return denied;
      if (result.status !== "authenticated") return failedResponse("export_unavailable");
      actor = result.actor;
      const params = await context.params;
      if (!isUuid(params.studentCaseId)) return errorResponse(400, "invalid_request");
      caseId = params.studentCaseId.toLowerCase();
      command = await readCommand(request);
      if (!command) return errorResponse(400, "invalid_request");
      client = dependencies.createServiceClient();
      const begun = await client.schema("platform").rpc("begin_student_profile_export", {
        p_organization_id: actor.organizationId, p_student_case_id: caseId,
        p_actor_auth_user_id: actor.authUserId, p_actor_membership_id: actor.membershipId,
        p_expected_profile_revision: command.expectedRevision, p_mode: command.mode,
        p_template_sha256: STUDENT_PROFILE_TEMPLATE_SHA256, p_request_id: command.requestId,
      });
      if (begun.error) {
        if (begun.error.code === "42501") return errorResponse(403, "forbidden");
        if (begun.error.code === "40001") return failedResponse("profile_changed");
        if (begun.error.code === "23505") return errorResponse(409, "request_conflict");
        if (begun.error.code === "22023") return errorResponse(400, "invalid_request");
        return failedResponse("export_unavailable");
      }
      attempt = normalizeAttempt(begun.data, actor, caseId, command);
    } catch { return failedResponse("export_unavailable"); }

    // No file is persisted in D2. A replay never rereads values or regenerates.
    if (!attempt.created) {
      if (attempt.status === "failed") return failedResponse(attempt.failureCode!);
      return errorResponse(409, attempt.status === "pending" ? "export_request_pending" : "export_request_completed");
    }

    async function complete(outcome: "generated" | "failed", bytes: Buffer | null, code: FailureCode | null): Promise<Completion | null> {
      try {
        const result = await client.schema("platform").rpc("complete_student_profile_export", {
          p_attempt_id: attempt.id, p_outcome: outcome,
          p_output_sha256: bytes ? createHash("sha256").update(bytes).digest("hex") : null,
          p_output_bytes: bytes?.byteLength ?? null, p_failure_code: code,
        });
        return result.error ? null : normalizeCompletion(result.data, attempt.id, outcome);
      } catch { return null; }
    }

    let bytes: Buffer;
    try {
      const snapshot = await dependencies.readSnapshot(actor, caseId);
      if (snapshot.studentCaseId !== caseId || snapshot.profile?.id !== attempt.studentProfileId
        || snapshot.profile.revision !== command.expectedRevision) throw new ExportFailure("profile_changed");
      if (!snapshot.canExport) throw new ExportFailure("access_changed");
      const values = getProfileExportValues(snapshot, command.mode);
      let template: Buffer;
      try { template = await dependencies.readTemplate(); }
      catch { throw new ExportFailure("template_unavailable"); }
      try { bytes = dependencies.render(template, values, command.mode); }
      catch { throw new ExportFailure("render_failed"); }
      if (!Buffer.isBuffer(bytes) || bytes.byteLength < 1 || bytes.byteLength > MAX_OUTPUT_BYTES) throw new ExportFailure("render_failed");
      const refreshed = await dependencies.loadActor();
      if (refreshed.status === "invalid") throw new ExportFailure("export_unavailable");
      if (refreshed.status !== "authenticated" || initialActorError(refreshed)
        || refreshed.actor.authUserId !== actor.authUserId || refreshed.actor.membershipId !== actor.membershipId
        || refreshed.actor.organizationId !== actor.organizationId) throw new ExportFailure("access_changed");
    } catch (error) {
      const failure = error instanceof ExportFailure ? error
        : error instanceof ProfileExportNotReadyError ? new ExportFailure("profile_not_ready", error.issues.map(({ key, kind }) => ({ key, kind })))
        : error instanceof PlatformStudentProfileFieldsError && error.outcome === "forbidden" ? new ExportFailure("access_changed")
        : new ExportFailure("export_unavailable");
      const completed = await complete("failed", null, failure.code);
      if (!completed) return failedResponse("export_unavailable");
      return failedResponse(completed.failureCode!, completed.failureCode === failure.code ? failure.issues : undefined);
    }
    // This one completion call is the last authority/revision fence. On an
    // unknown result, no bytes and no second completion request are attempted.
    const completed = await complete("generated", bytes, null);
    if (!completed) return failedResponse("export_unavailable");
    if (completed.status === "failed") return failedResponse(completed.failureCode!);
    return new Response(new Uint8Array(bytes), { status: 200, headers: {
      ...HEADERS,
      "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "content-disposition": `attachment; filename="student-profile-${command.mode}.docx"`,
      "content-length": String(bytes.byteLength),
    } });
  };
}

export function studentProfileExportMethodNotAllowed(): Response {
  return new Response(null, { status: 405, headers: { ...HEADERS, allow: "POST" } });
}
