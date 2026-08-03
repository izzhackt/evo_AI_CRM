"use server";

import { createHash } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  PLATFORM_CATALOG_INSTITUTION_KINDS,
  PLATFORM_CATALOG_SOURCE_KINDS,
  type PlatformCatalogInstitutionKind,
  type PlatformCatalogSourceKind,
} from "./platform-catalog";
import { deriveCatalogSourceRecordKey } from "./platform-catalog-provenance";
import { parsePlatformAdmissionsUuid } from "./platform-admissions";
import { requirePlatformApplicationsActor } from "./platform-guards";
import { createSupabaseServerClient } from "./supabase/server";

const CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const SOURCE_REVISION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{6,127}$/;

type CatalogMutationOutcome =
  | "source_saved"
  | "source_reviewed"
  | "source_rejected"
  | "batch_created"
  | "candidate_staged"
  | "batch_validated"
  | "batch_approved"
  | "batch_rejected"
  | "invalid"
  | "unavailable";

function value(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}

function requiredUuid(form: FormData, key: string): string | null {
  return parsePlatformAdmissionsUuid(value(form, key));
}

function boundedText(
  form: FormData,
  key: string,
  minimum: number,
  maximum: number,
): string | null {
  const candidate = value(form, key);
  if (
    candidate.length < minimum ||
    candidate.length > maximum ||
    CONTROL_CHARACTER_PATTERN.test(candidate)
  ) {
    return null;
  }
  return candidate;
}

function optionalBoundedText(
  form: FormData,
  key: string,
  maximum: number,
): string | null | undefined {
  const candidate = value(form, key);
  if (!candidate) return null;
  if (
    candidate.length > maximum ||
    CONTROL_CHARACTER_PATTERN.test(candidate)
  ) {
    return undefined;
  }
  return candidate;
}

function stagingText(
  form: FormData,
  key: string,
  maximum: number,
): string | null {
  const candidate = value(form, key);
  return candidate.length <= maximum && !CONTROL_CHARACTER_PATTERN.test(candidate)
    ? candidate
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function institutionKind(value: string): PlatformCatalogInstitutionKind | null {
  return (PLATFORM_CATALOG_INSTITUTION_KINDS as readonly string[]).includes(value)
    ? (value as PlatformCatalogInstitutionKind)
    : null;
}

function sourceKind(value: string): PlatformCatalogSourceKind | null {
  return (PLATFORM_CATALOG_SOURCE_KINDS as readonly string[]).includes(value)
    ? (value as PlatformCatalogSourceKind)
    : null;
}

function opaqueKey(prefix: "src" | "rec", parts: readonly string[]): string {
  return `${prefix}_${createHash("sha256").update(parts.join("\u001f")).digest("hex")}`;
}

function safeRedirect(
  outcome: CatalogMutationOutcome,
  options: Readonly<{
    retryRequestId?: string | null;
    retryOperation?: string | null;
    batchId?: string | null;
  }> = {},
): never {
  const params = new URLSearchParams({ catalog_result: outcome });
  if (options.retryRequestId && options.retryOperation) {
    params.set("catalog_retry_request_id", options.retryRequestId);
    params.set("catalog_retry_op", options.retryOperation);
  }
  if (options.batchId) params.set("catalog_batch_id", options.batchId);
  redirect(`/applications?${params.toString()}#catalog-import`);
}

async function requireAdmin() {
  const actor = await requirePlatformApplicationsActor();
  if (actor.platformRole !== "admin") safeRedirect("unavailable");
  return actor;
}

function responseUuid(
  value: unknown,
  key: string,
  expectedOrganizationId: string,
): string | null {
  if (
    !isRecord(value) ||
    parsePlatformAdmissionsUuid(value.organization_id) !== expectedOrganizationId
  ) {
    return null;
  }
  return parsePlatformAdmissionsUuid(value[key]);
}

export async function registerPlatformCatalogSourceAction(
  form: FormData,
): Promise<void> {
  const actor = await requireAdmin();
  const requestId = requiredUuid(form, "request_id");
  const kind = sourceKind(value(form, "source_kind"));
  const sourceUrl = boundedText(form, "source_url", 1, 512);
  const sourceRevision = boundedText(form, "source_revision", 7, 128);
  const reason = boundedText(form, "reason", 3, 500);
  const retryOperation = "register_source";
  if (
    !requestId ||
    !kind ||
    !sourceUrl ||
    !sourceRevision ||
    !SOURCE_REVISION_PATTERN.test(sourceRevision) ||
    !reason
  ) {
    safeRedirect("invalid", {
      retryRequestId: requestId,
      retryOperation,
    });
  }
  try {
    const client = await createSupabaseServerClient();
    const response = await client.schema("platform").rpc(
      "register_workflow_source",
      {
        p_organization_id: actor.organizationId,
        p_source_key: opaqueKey("src", [
          actor.organizationId,
          kind,
          sourceUrl,
          sourceRevision,
        ]),
        p_source_kind: kind,
        p_source_url: sourceUrl,
        p_source_revision: sourceRevision,
        p_reason: reason,
        p_request_id: requestId,
      },
    );
    if (response.error || !parsePlatformAdmissionsUuid(response.data)) {
      safeRedirect("unavailable", {
        retryRequestId: requestId,
        retryOperation,
      });
    }
  } catch {
    safeRedirect("unavailable", {
      retryRequestId: requestId,
      retryOperation,
    });
  }
  revalidatePath("/applications");
  safeRedirect("source_saved");
}

export async function reviewPlatformCatalogSourceAction(
  form: FormData,
): Promise<void> {
  const actor = await requireAdmin();
  const sourceRegistryId = requiredUuid(form, "source_registry_id");
  const requestId = requiredUuid(form, "request_id");
  const decision = value(form, "decision");
  const reason = boundedText(form, "reason", 3, 500);
  const retryOperation = `review_source:${sourceRegistryId ?? "invalid"}`;
  if (
    !sourceRegistryId ||
    !requestId ||
    !["reviewed", "rejected"].includes(decision) ||
    !reason
  ) {
    safeRedirect("invalid", { retryRequestId: requestId, retryOperation });
  }
  try {
    const client = await createSupabaseServerClient();
    const response = await client.schema("platform").rpc(
      "review_workflow_source",
      {
        p_organization_id: actor.organizationId,
        p_source_registry_id: sourceRegistryId,
        p_decision: decision,
        p_reason: reason,
        p_request_id: requestId,
      },
    );
    if (
      response.error ||
      parsePlatformAdmissionsUuid(response.data) !== sourceRegistryId
    ) {
      safeRedirect("unavailable", { retryRequestId: requestId, retryOperation });
    }
  } catch {
    safeRedirect("unavailable", { retryRequestId: requestId, retryOperation });
  }
  revalidatePath("/applications");
  safeRedirect(decision === "reviewed" ? "source_reviewed" : "source_rejected");
}

export async function createPlatformCatalogImportBatchAction(
  form: FormData,
): Promise<void> {
  const actor = await requireAdmin();
  const sourceRegistryId = requiredUuid(form, "source_registry_id");
  const requestId = requiredUuid(form, "request_id");
  const kind = institutionKind(value(form, "institution_kind"));
  const reason = boundedText(form, "reason", 3, 500);
  const retryOperation = "create_batch";
  if (!sourceRegistryId || !requestId || !kind || !reason) {
    safeRedirect("invalid", { retryRequestId: requestId, retryOperation });
  }
  let createdBatchId: string | null = null;
  try {
    const client = await createSupabaseServerClient();
    const response = await client.schema("platform").rpc(
      "create_catalog_import_batch",
      {
        p_organization_id: actor.organizationId,
        p_source_registry_id: sourceRegistryId,
        p_institution_kind: kind,
        p_reason: reason,
        p_request_id: requestId,
      },
    );
    createdBatchId = responseUuid(
      response.data,
      "catalog_import_batch_id",
      actor.organizationId,
    );
    if (response.error || !createdBatchId) {
      safeRedirect("unavailable", { retryRequestId: requestId, retryOperation });
    }
  } catch {
    safeRedirect("unavailable", { retryRequestId: requestId, retryOperation });
  }
  revalidatePath("/applications");
  safeRedirect("batch_created", { batchId: createdBatchId });
}

export async function stagePlatformCatalogImportCandidateAction(
  form: FormData,
): Promise<void> {
  const actor = await requireAdmin();
  const batchId = requiredUuid(form, "catalog_import_batch_id");
  const requestId = requiredUuid(form, "request_id");
  const sourceRecordReference = boundedText(
    form,
    "source_record_reference",
    1,
    500,
  );
  const institutionName = stagingText(form, "institution_name", 300);
  const countryCode = stagingText(form, "country_code", 8);
  const city = optionalBoundedText(form, "city", 200);
  const reason = boundedText(form, "reason", 3, 500);
  const retryOperation = `stage_candidate:${batchId ?? "invalid"}`;
  if (
    !batchId ||
    !requestId ||
    !sourceRecordReference ||
    institutionName === null ||
    countryCode === null ||
    city === undefined ||
    !reason
  ) {
    safeRedirect("invalid", {
      retryRequestId: requestId,
      retryOperation,
      batchId,
    });
  }
  try {
    const client = await createSupabaseServerClient();
    const response = await client.schema("platform").rpc(
      "stage_catalog_import_candidate",
      {
        p_organization_id: actor.organizationId,
        p_catalog_import_batch_id: batchId,
        p_source_record_key: deriveCatalogSourceRecordKey(
          actor.organizationId,
          sourceRecordReference,
        ),
        p_institution_name: institutionName,
        p_country_code: countryCode,
        p_city: city,
        p_reason: reason,
        p_request_id: requestId,
      },
    );
    const candidateId = responseUuid(
      response.data,
      "catalog_import_candidate_id",
      actor.organizationId,
    );
    if (
      response.error ||
      !candidateId ||
      !isRecord(response.data) ||
      parsePlatformAdmissionsUuid(response.data.catalog_import_batch_id) !== batchId
    ) {
      safeRedirect("unavailable", {
        retryRequestId: requestId,
        retryOperation,
        batchId,
      });
    }
  } catch {
    safeRedirect("unavailable", {
      retryRequestId: requestId,
      retryOperation,
      batchId,
    });
  }
  revalidatePath("/applications");
  safeRedirect("candidate_staged", { batchId });
}

export async function validatePlatformCatalogImportBatchAction(
  form: FormData,
): Promise<void> {
  const actor = await requireAdmin();
  const batchId = requiredUuid(form, "catalog_import_batch_id");
  const requestId = requiredUuid(form, "request_id");
  const reason = boundedText(form, "reason", 3, 500);
  const retryOperation = `validate_batch:${batchId ?? "invalid"}`;
  if (!batchId || !requestId || !reason) {
    safeRedirect("invalid", { retryRequestId: requestId, retryOperation, batchId });
  }
  try {
    const client = await createSupabaseServerClient();
    const response = await client.schema("platform").rpc(
      "validate_catalog_import_batch",
      {
        p_organization_id: actor.organizationId,
        p_catalog_import_batch_id: batchId,
        p_reason: reason,
        p_request_id: requestId,
      },
    );
    if (
      response.error ||
      responseUuid(response.data, "catalog_import_batch_id", actor.organizationId) !==
        batchId ||
      !isRecord(response.data) ||
      response.data.status !== "validated"
    ) {
      safeRedirect("unavailable", {
        retryRequestId: requestId,
        retryOperation,
        batchId,
      });
    }
  } catch {
    safeRedirect("unavailable", {
      retryRequestId: requestId,
      retryOperation,
      batchId,
    });
  }
  revalidatePath("/applications");
  safeRedirect("batch_validated", { batchId });
}

export async function reviewPlatformCatalogImportBatchAction(
  form: FormData,
): Promise<void> {
  const actor = await requireAdmin();
  const batchId = requiredUuid(form, "catalog_import_batch_id");
  const requestId = requiredUuid(form, "request_id");
  const decision = value(form, "decision");
  const reason = boundedText(form, "reason", 3, 500);
  const retryOperation = `review_batch:${batchId ?? "invalid"}:${decision}`;
  if (
    !batchId ||
    !requestId ||
    !["approve", "reject"].includes(decision) ||
    !reason
  ) {
    safeRedirect("invalid", { retryRequestId: requestId, retryOperation, batchId });
  }
  const expectedStatus = decision === "approve" ? "approved" : "rejected";
  try {
    const client = await createSupabaseServerClient();
    const response = await client.schema("platform").rpc(
      "review_catalog_import_batch",
      {
        p_organization_id: actor.organizationId,
        p_catalog_import_batch_id: batchId,
        p_decision: decision,
        p_reason: reason,
        p_request_id: requestId,
      },
    );
    if (
      response.error ||
      responseUuid(response.data, "catalog_import_batch_id", actor.organizationId) !==
        batchId ||
      !isRecord(response.data) ||
      response.data.status !== expectedStatus
    ) {
      safeRedirect("unavailable", {
        retryRequestId: requestId,
        retryOperation,
        batchId,
      });
    }
  } catch {
    safeRedirect("unavailable", {
      retryRequestId: requestId,
      retryOperation,
      batchId,
    });
  }
  revalidatePath("/applications");
  safeRedirect(decision === "approve" ? "batch_approved" : "batch_rejected", {
    batchId,
  });
}
