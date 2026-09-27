/**
 * OTH-1 «Воронка поступления» — curator kanban board.
 *
 * Reads platform.staff_admissions_pipeline_board_v1 and writes through
 * platform.move_case_pipeline_v2 (migration 251: v1 of 187/244 plus an
 * optional expected version for «Отменить»). This is a curator-owned
 * kanban position (`pipeline_stage`/`pipeline_hidden_at` on
 * platform.student_cases), fully decoupled from the fact-gated admissions
 * playbook: this module never calls platform.transition_case_admissions_v1
 * and never reads/writes operational_stage, admissions_version or
 * admissions_facts. Decode/error-mapping style mirrors platform-admissions.ts
 * (strict manual decoding, fail-closed) and platform-sales.ts's
 * mutationErrorFromRpc (errcode/message pair -> a small status enum).
 */
import { staffCan, staffHasPermission } from "./platform-access.ts";
import {
  ADMISSIONS_PIPELINE_STAGES,
  type AdmissionsPipelineBoard,
  type AdmissionsPipelineBoardFilters,
  type AdmissionsPipelineRow,
  type AdmissionsPipelineStage,
} from "./platform-admissions-pipeline-contract.ts";

export {
  ADMISSIONS_PIPELINE_STAGES,
  ADMISSIONS_PIPELINE_TAB_STAGES,
  admissionsPipelineTabOf,
  type AdmissionsPipelineBoard,
  type AdmissionsPipelineBoardFilters,
  type AdmissionsPipelineRow,
  type AdmissionsPipelineStage,
  type AdmissionsPipelineTab,
} from "./platform-admissions-pipeline-contract.ts";
import type { PlatformActor } from "./platform-auth";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const SAFE_REPOSITORY_ERROR_MESSAGE = "Admissions pipeline board data is unavailable.";
const SAFE_MUTATION_ERROR_MESSAGE = "Admissions pipeline board update failed.";

export class PlatformAdmissionsPipelineRepositoryError extends Error {
  constructor() {
    super(SAFE_REPOSITORY_ERROR_MESSAGE);
    this.name = "PlatformAdmissionsPipelineRepositoryError";
  }
}

function invalidShape(): never {
  throw new PlatformAdmissionsPipelineRepositoryError();
}

function failClosed(error: unknown): never {
  if (error instanceof PlatformAdmissionsPipelineRepositoryError) throw error;
  return invalidShape();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredUuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) return invalidShape();
  const normalized = value.toLowerCase();
  return normalized === NIL_UUID ? invalidShape() : normalized;
}

function optionalUuid(value: unknown): string | null {
  return value === null ? null : requiredUuid(value);
}

function requiredText(value: unknown, maxLength = 500): string {
  if (typeof value !== "string") return invalidShape();
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > maxLength ||
    CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    return invalidShape();
  }
  return normalized;
}

function optionalText(value: unknown, maxLength = 500): string | null {
  return value === null ? null : requiredText(value, maxLength);
}

function requiredBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") return invalidShape();
  return value;
}

function requiredStage(value: unknown): AdmissionsPipelineStage {
  if (
    typeof value !== "string" ||
    !(ADMISSIONS_PIPELINE_STAGES as readonly string[]).includes(value)
  ) {
    return invalidShape();
  }
  return value as AdmissionsPipelineStage;
}

function requireAdmissionsOrganization(actor: PlatformActor): string {
  if (!staffCan(actor, "admissions.read")) return invalidShape();
  return requiredUuid(actor.organizationId);
}

async function getPlatformClient() {
  if (typeof window !== "undefined") return invalidShape();
  const { createSupabaseServerClient } = await import("./supabase/server");
  return createSupabaseServerClient();
}

function normalizeRow(value: unknown): AdmissionsPipelineRow {
  if (!isRecord(value)) return invalidShape();
  return Object.freeze({
    studentCaseId: requiredUuid(value.student_case_id),
    studentDisplayName: requiredText(value.student_display_name, 200),
    targetCountry: optionalText(value.target_country, 16),
    primaryInstitutionName: optionalText(value.primary_institution_name, 300),
    currentCuratorMembershipId: optionalUuid(value.current_curator_membership_id),
    currentCuratorDisplayName: optionalText(value.current_curator_display_name, 200),
    pipelineStage: requiredStage(value.pipeline_stage),
    awaitingAck: requiredBoolean(value.awaiting_ack),
    overdue: requiredBoolean(value.overdue),
    // OTH-5, migration 191: the board RPC now also returns needs_reply. The
    // OLD RPC body (pre-191) never sends this key — decode it as absent-safe
    // false rather than requiredBoolean, so this same client build keeps
    // working against the board during a rolling deploy window.
    needsReply: value.needs_reply === true,
  });
}

export function normalizeAdmissionsPipelineBoard(value: unknown): AdmissionsPipelineBoard {
  if (!isRecord(value) || !Array.isArray(value.rows) || value.rows.length > 400) {
    return invalidShape();
  }
  const seen = new Set<string>();
  const rows = value.rows.map((raw) => {
    const row = normalizeRow(raw);
    if (seen.has(row.studentCaseId)) return invalidShape();
    seen.add(row.studentCaseId);
    return row;
  });
  return Object.freeze({ rows, truncated: requiredBoolean(value.truncated) });
}

export async function readAdmissionsPipelineBoard(
  actor: PlatformActor,
  filters: AdmissionsPipelineBoardFilters = {},
): Promise<AdmissionsPipelineBoard> {
  try {
    requireAdmissionsOrganization(actor);
    const curatorMembershipId = filters.curatorMembershipId
      ? requiredUuid(filters.curatorMembershipId)
      : null;
    const country = filters.country ? requiredText(filters.country, 16) : null;
    const query = filters.query?.trim() || null;
    if (query !== null && (query.length > 200 || CONTROL_CHARACTER_PATTERN.test(query))) {
      return invalidShape();
    }
    const client = await getPlatformClient();
    const response = await client.schema("platform").rpc(
      "staff_admissions_pipeline_board_v1",
      {
        // GET serializes null as the string "null". Omit unset filters so
        // the RPC uses its SQL NULL defaults, including the UUID argument.
        p_curator_membership_id: curatorMembershipId ?? undefined,
        p_country: country ?? undefined,
        p_query: query ?? undefined,
      },
      { get: true },
    );
    if (response.error) return invalidShape();
    return normalizeAdmissionsPipelineBoard(response.data);
  } catch (error) {
    return failClosed(error);
  }
}

// ---------------------------------------------------------------------------
// Mutation: platform.move_case_pipeline_v2 (251)
// ---------------------------------------------------------------------------

export type MoveCasePipelineStatus =
  | "saved"
  | "invalid"
  | "forbidden"
  | "request_conflict"
  /** 251: the expected version is stale — someone moved the case in between. */
  | "moved"
  | "unavailable";

/** The board position the server reports: where the card really is. */
export type AdmissionsPipelinePosition = Readonly<{
  pipelineStage: AdmissionsPipelineStage;
  pipelineHidden: boolean;
  pipelineVersion: number;
}>;

export class PlatformAdmissionsPipelineMutationError extends Error {
  readonly status: MoveCasePipelineStatus;
  /** Only for "moved": the current position from the refusal, when it decoded. */
  readonly current: AdmissionsPipelinePosition | null;

  constructor(status: MoveCasePipelineStatus, current: AdmissionsPipelinePosition | null = null) {
    super(SAFE_MUTATION_ERROR_MESSAGE);
    this.name = "PlatformAdmissionsPipelineMutationError";
    this.status = status;
    this.current = current;
  }
}

function mutationFailure(status: MoveCasePipelineStatus): never {
  throw new PlatformAdmissionsPipelineMutationError(status);
}

export type MoveCasePipelineInput = Readonly<{
  studentCaseId: string;
  requestId: string;
  /**
   * 251: the version of the caller's own move (its receipt). The server
   * refuses with "moved" when the case has moved since — the undo never
   * overwrites someone else's later move. Absent: last write wins, as v1.
   */
  expectedVersion?: number;
}> &
  (
    | Readonly<{ remove: true; stage?: undefined }>
    | Readonly<{ remove?: false; stage: AdmissionsPipelineStage }>
  );

export type MoveCasePipelineReceipt = Readonly<{
  studentCaseId: string;
  pipelineStage: AdmissionsPipelineStage;
  pipelineHidden: boolean;
  /** null only for a replayed receipt of the v1 command (no version in it). */
  pipelineVersion: number | null;
  requestId: string;
}>;

function requiredVersion(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) return invalidShape();
  return value;
}

function normalizeMoveCasePipelineReceipt(value: unknown): MoveCasePipelineReceipt {
  // requiredUuid/requiredStage/requiredBoolean throw
  // PlatformAdmissionsPipelineRepositoryError on a shape mismatch; a
  // malformed receipt is exactly the "unavailable" mutation outcome, not a
  // read failure, so any throw here is remapped to that status.
  try {
    if (!isRecord(value)) return invalidShape();
    return Object.freeze({
      studentCaseId: requiredUuid(value.student_case_id),
      pipelineStage: requiredStage(value.pipeline_stage),
      pipelineHidden: requiredBoolean(value.pipeline_hidden),
      // The v1 receipt (a request id first accepted by v1) has no version.
      pipelineVersion: value.pipeline_version === undefined ? null : requiredVersion(value.pipeline_version),
      requestId: requiredUuid(value.request_id),
    });
  } catch {
    return mutationFailure("unavailable");
  }
}

/** DETAIL of case_pipeline_moved: the current position as JSON; anything else is null. */
export function positionFromMovedDetail(details: unknown): AdmissionsPipelinePosition | null {
  if (typeof details !== "string" || details.length > 500) return null;
  try {
    const value: unknown = JSON.parse(details);
    if (!isRecord(value)) return null;
    return Object.freeze({
      pipelineStage: requiredStage(value.pipeline_stage),
      pipelineHidden: requiredBoolean(value.pipeline_hidden),
      pipelineVersion: requiredVersion(value.pipeline_version),
    });
  } catch {
    return null;
  }
}

export function moveCasePipelineErrorFromRpc(error: unknown): PlatformAdmissionsPipelineMutationError {
  if (!isRecord(error)) return new PlatformAdmissionsPipelineMutationError("unavailable");
  const code = typeof error.code === "string" ? error.code : null;
  const message = typeof error.message === "string" ? error.message.trim() : null;
  if (code === "PT409" && message === "case_pipeline_moved") {
    return new PlatformAdmissionsPipelineMutationError("moved", positionFromMovedDetail(error.details));
  }
  const status: MoveCasePipelineStatus =
    code === "42501" && message === "case_pipeline_forbidden"
      ? "forbidden"
      : code === "22023" && message === "case_pipeline_request_id_conflict"
        ? "request_conflict"
        : code === "22023" &&
            (message === "case_pipeline_invalid_command" ||
              message === "Case is not active in this pipeline")
          ? "invalid"
          : "unavailable";
  return new PlatformAdmissionsPipelineMutationError(status);
}

export async function moveCasePipeline(
  actor: PlatformActor,
  input: MoveCasePipelineInput,
): Promise<MoveCasePipelineReceipt> {
  let organizationId: string;
  let studentCaseId: string;
  let requestId: string;
  let expectedVersion: number | null;
  try {
    organizationId = requireAdmissionsOrganization(actor);
    // The key move_case_pipeline_v2 checks per case (244, 251); the broad
    // admissions.write section also covers roles the server refuses.
    if (!staffHasPermission(actor, "case.update.append")) mutationFailure("forbidden");
    studentCaseId = requiredUuid(input.studentCaseId);
    requestId = requiredUuid(input.requestId);
    if (!input.remove) requiredStage(input.stage);
    expectedVersion = input.expectedVersion === undefined ? null : requiredVersion(input.expectedVersion);
  } catch (error) {
    if (error instanceof PlatformAdmissionsPipelineMutationError) throw error;
    throw new PlatformAdmissionsPipelineMutationError("unavailable");
  }

  try {
    const client = await getPlatformClient();
    const response = await client.schema("platform").rpc("move_case_pipeline_v2", {
      p_organization_id: organizationId,
      p_student_case_id: studentCaseId,
      p_stage: input.remove ? null : input.stage,
      p_remove: Boolean(input.remove),
      p_request_id: requestId,
      p_expected_version: expectedVersion,
    });
    if (response.error) throw moveCasePipelineErrorFromRpc(response.error);
    return normalizeMoveCasePipelineReceipt(response.data);
  } catch (error) {
    if (error instanceof PlatformAdmissionsPipelineMutationError) throw error;
    throw new PlatformAdmissionsPipelineMutationError("unavailable");
  }
}
