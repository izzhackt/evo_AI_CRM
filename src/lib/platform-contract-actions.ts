"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requirePlatformClientsActor } from "./platform-guards";
import {
  PLATFORM_CONTRACT_REVIEW_DECISIONS,
  PLATFORM_CONTRACT_TEMPLATE_STATUSES,
  PLATFORM_POST_CONTRACT_ITEM_STATUSES,
  buildPlatformContractRedirectTarget,
  buildPlatformCreateContractTemplateRpcArgs,
  getPlatformCaseContractWorkspace,
  parsePlatformContractUuid,
  parsePlatformCreateContractTemplateForm,
  parsePlatformGeneratePostContractReportForm,
  parsePlatformReviewContractDraftForm,
  parsePlatformReviewPostContractReportForm,
  parsePlatformTemplateLifecycleForm,
  parsePlatformUpdatePostContractItemForm,
  platformContractResponseValidators,
  requirePlatformContractMutationResponse,
  type PlatformCaseContractWorkspace,
  type PlatformContractMutationOutcome,
  type PlatformContractRetryOperation,
} from "./platform-contract-workflow";
import { createSupabaseServerClient } from "./supabase/server";

type RetryMetadata = Readonly<{
  requestId: string;
  operation: PlatformContractRetryOperation;
  subjectId?: string;
}>;

function strictFormString(form: FormData, key: string): string | undefined {
  const values = form.getAll(key);
  if (values.length > 1) return undefined;
  if (values.length === 0) return "";
  return typeof values[0] === "string" ? values[0].trim() : undefined;
}

function rawUuid(form: FormData, key: string): string | null {
  const value = strictFormString(form, key);
  return value === undefined ? null : parsePlatformContractUuid(value);
}

function retryRequestId(form: FormData, generated: string): string | null {
  const value = strictFormString(form, "request_id");
  if (value === undefined) return null;
  return parsePlatformContractUuid(value || generated);
}

function mutationRedirect(
  studentCaseId: string | null,
  outcome: PlatformContractMutationOutcome,
  retry?: RetryMetadata,
): never {
  redirect(buildPlatformContractRedirectTarget(studentCaseId, outcome, retry));
}

function mutationErrorOutcome(error: unknown): "invalid" | "unavailable" {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return "unavailable";
  }
  const code = String(error.code);
  return ["22000", "22023", "23503", "23505", "23514", "55000"].includes(code)
    ? "invalid"
    : "unavailable";
}

async function workspaceOrRedirect(
  actor: Awaited<ReturnType<typeof requirePlatformClientsActor>>,
  studentCaseId: string,
  retry: RetryMetadata,
): Promise<PlatformCaseContractWorkspace> {
  try {
    const workspace = await getPlatformCaseContractWorkspace(actor, studentCaseId);
    if (!workspace) mutationRedirect(studentCaseId, "invalid", retry);
    return workspace;
  } catch {
    mutationRedirect(studentCaseId, "unavailable", retry);
  }
}

async function callRpc(
  name: string,
  args: Record<string, unknown>,
): Promise<{ data: unknown; error: unknown }> {
  try {
    const client = await createSupabaseServerClient();
    return await client.schema("platform").rpc(name, args);
  } catch {
    return { data: null, error: { code: "unavailable" } };
  }
}

function requireBaseResponse(
  value: unknown,
  keys: readonly string[],
  organizationId: string,
  actorMembershipId: string,
): Record<string, unknown> {
  const row = requirePlatformContractMutationResponse(value, keys);
  if (
    platformContractResponseValidators.requiredUuid(row.organization_id) !==
      organizationId ||
    platformContractResponseValidators.requiredUuid(row.actor_membership_id) !==
      actorMembershipId
  ) {
    throw new Error("Invalid BW6 response");
  }
  return row;
}

const TEMPLATE_RESPONSE_KEYS = [
  "organization_id",
  "contract_template_version_id",
  "template_key",
  "version",
  "status",
  "source_registry_id",
  "source_revision",
  "template_sha256",
  "blueprint_sha256",
  "actor_membership_id",
  "input_sha256",
] as const;

function validateTemplateResponse(
  value: unknown,
  expected: Readonly<{
    organizationId: string;
    actorMembershipId: string;
    templateId?: string;
    templateKey?: string;
    sourceRegistryId?: string;
    status: "draft" | "approved" | "retired";
  }>,
): string {
  const row = requireBaseResponse(
    value,
    TEMPLATE_RESPONSE_KEYS,
    expected.organizationId,
    expected.actorMembershipId,
  );
  const templateId = platformContractResponseValidators.requiredUuid(
    row.contract_template_version_id,
  );
  if (
    (expected.templateId && templateId !== expected.templateId) ||
    (expected.templateKey && row.template_key !== expected.templateKey) ||
    (expected.sourceRegistryId && row.source_registry_id !== expected.sourceRegistryId) ||
    row.status !== expected.status ||
    !PLATFORM_CONTRACT_TEMPLATE_STATUSES.includes(
      row.status as (typeof PLATFORM_CONTRACT_TEMPLATE_STATUSES)[number],
    )
  ) {
    throw new Error("Invalid BW6 template response");
  }
  platformContractResponseValidators.safeSingleLine(row.template_key, 1, 128);
  platformContractResponseValidators.positiveInteger(row.version);
  platformContractResponseValidators.requiredUuid(row.source_registry_id);
  platformContractResponseValidators.safeSingleLine(row.source_revision, 7, 128);
  platformContractResponseValidators.sha256(row.template_sha256);
  platformContractResponseValidators.sha256(row.blueprint_sha256);
  platformContractResponseValidators.sha256(row.input_sha256);
  return templateId;
}

function invalidFormRedirect(
  form: FormData,
  fallbackRequestId: string,
  operation: PlatformContractRetryOperation,
  subjectKey?: string,
): never {
  const studentCaseId = rawUuid(form, "student_case_id");
  const requestId = retryRequestId(form, fallbackRequestId);
  const subjectId = subjectKey ? rawUuid(form, subjectKey) : null;
  mutationRedirect(
    studentCaseId,
    "invalid",
    requestId
      ? { requestId, operation, ...(subjectId ? { subjectId } : {}) }
      : undefined,
  );
}

export async function createPlatformContractTemplateVersionAction(
  form: FormData,
): Promise<void> {
  const actor = await requirePlatformClientsActor();
  const generatedRequestId = randomUUID();
  const input = parsePlatformCreateContractTemplateForm(form, generatedRequestId);
  if (!input) invalidFormRedirect(form, generatedRequestId, "create_template");
  const retry = { requestId: input.requestId, operation: "create_template" } as const;
  const workspace = await workspaceOrRedirect(actor, input.studentCaseId, retry);
  if (
    !workspace.canManageTemplates ||
    !workspace.reviewedSources.some(
      (source) => source.sourceRegistryId === input.sourceRegistryId,
    )
  ) {
    mutationRedirect(input.studentCaseId, "not_allowed");
  }
  const response = await callRpc(
    "create_contract_template_version",
    buildPlatformCreateContractTemplateRpcArgs(actor.organizationId, input),
  );
  if (response.error) {
    mutationRedirect(
      input.studentCaseId,
      mutationErrorOutcome(response.error),
      retry,
    );
  }
  try {
    validateTemplateResponse(response.data, {
      organizationId: actor.organizationId,
      actorMembershipId: actor.membershipId,
      templateKey: input.templateKey,
      sourceRegistryId: input.sourceRegistryId,
      status: "draft",
    });
  } catch {
    mutationRedirect(input.studentCaseId, "unavailable", retry);
  }
  revalidatePath(`/clients/${input.studentCaseId}`);
  mutationRedirect(input.studentCaseId, "template_created");
}

async function templateLifecycleAction(
  form: FormData,
  operation: "approve_template" | "retire_template",
): Promise<never> {
  const actor = await requirePlatformClientsActor();
  const generatedRequestId = randomUUID();
  const input = parsePlatformTemplateLifecycleForm(form, generatedRequestId);
  if (!input) {
    invalidFormRedirect(
      form,
      generatedRequestId,
      operation,
      "contract_template_version_id",
    );
  }
  const retry = {
    requestId: input.requestId,
    operation,
    subjectId: input.contractTemplateVersionId,
  } as const;
  const workspace = await workspaceOrRedirect(actor, input.studentCaseId, retry);
  const template = workspace.templates.find(
    (item) => item.contractTemplateVersionId === input.contractTemplateVersionId,
  );
  const expectedCurrentStatus = operation === "approve_template" ? "draft" : "approved";
  if (
    !workspace.canManageTemplates ||
    !template ||
    template.status !== expectedCurrentStatus
  ) {
    mutationRedirect(input.studentCaseId, "not_allowed");
  }
  const response = await callRpc(
    operation === "approve_template"
      ? "approve_contract_template_version"
      : "retire_contract_template_version",
    {
      p_organization_id: actor.organizationId,
      p_contract_template_version_id: input.contractTemplateVersionId,
      p_reason: input.reason,
      p_request_id: input.requestId,
    },
  );
  if (response.error) {
    mutationRedirect(input.studentCaseId, mutationErrorOutcome(response.error), retry);
  }
  const nextStatus = operation === "approve_template" ? "approved" : "retired";
  try {
    validateTemplateResponse(response.data, {
      organizationId: actor.organizationId,
      actorMembershipId: actor.membershipId,
      templateId: input.contractTemplateVersionId,
      status: nextStatus,
    });
  } catch {
    mutationRedirect(input.studentCaseId, "unavailable", retry);
  }
  revalidatePath(`/clients/${input.studentCaseId}`);
  mutationRedirect(
    input.studentCaseId,
    operation === "approve_template" ? "template_approved" : "template_retired",
  );
}

export async function approvePlatformContractTemplateVersionAction(
  form: FormData,
): Promise<void> {
  await templateLifecycleAction(form, "approve_template");
}

export async function retirePlatformContractTemplateVersionAction(
  form: FormData,
): Promise<void> {
  await templateLifecycleAction(form, "retire_template");
}

export async function generatePlatformStudentCaseContractDraftAction(
  form: FormData,
): Promise<void> {
  const actor = await requirePlatformClientsActor();
  const generatedRequestId = randomUUID();
  const input = parsePlatformTemplateLifecycleForm(form, generatedRequestId);
  if (!input) {
    invalidFormRedirect(
      form,
      generatedRequestId,
      "generate_draft",
      "contract_template_version_id",
    );
  }
  const retry = {
    requestId: input.requestId,
    operation: "generate_draft",
    subjectId: input.contractTemplateVersionId,
  } as const;
  const workspace = await workspaceOrRedirect(actor, input.studentCaseId, retry);
  if (
    !workspace.canGenerateContract ||
    !workspace.templates.some(
      (template) =>
        template.contractTemplateVersionId === input.contractTemplateVersionId &&
        template.status === "approved",
    )
  ) {
    mutationRedirect(input.studentCaseId, "not_allowed");
  }
  const response = await callRpc("generate_student_case_contract_draft", {
    p_organization_id: actor.organizationId,
    p_student_case_id: input.studentCaseId,
    p_contract_template_version_id: input.contractTemplateVersionId,
    p_reason: input.reason,
    p_request_id: input.requestId,
  });
  if (response.error) {
    mutationRedirect(input.studentCaseId, mutationErrorOutcome(response.error), retry);
  }
  try {
    const row = requireBaseResponse(
      response.data,
      [
        "organization_id",
        "student_case_id",
        "student_case_contract_draft_id",
        "contract_template_version_id",
        "version",
        "status",
        "input_sha256",
        "rendered_sha256",
        "actor_membership_id",
      ],
      actor.organizationId,
      actor.membershipId,
    );
    if (
      platformContractResponseValidators.requiredUuid(row.student_case_id) !==
        input.studentCaseId ||
      platformContractResponseValidators.requiredUuid(
        row.contract_template_version_id,
      ) !== input.contractTemplateVersionId ||
      row.status !== "draft"
    ) {
      throw new Error("Invalid BW6 draft response");
    }
    platformContractResponseValidators.requiredUuid(
      row.student_case_contract_draft_id,
    );
    platformContractResponseValidators.positiveInteger(row.version);
    platformContractResponseValidators.sha256(row.input_sha256);
    platformContractResponseValidators.sha256(row.rendered_sha256);
  } catch {
    mutationRedirect(input.studentCaseId, "unavailable", retry);
  }
  revalidatePath(`/clients/${input.studentCaseId}`);
  mutationRedirect(input.studentCaseId, "draft_generated");
}

export async function reviewPlatformStudentCaseContractDraftAction(
  form: FormData,
): Promise<void> {
  const actor = await requirePlatformClientsActor();
  const generatedRequestId = randomUUID();
  const input = parsePlatformReviewContractDraftForm(form, generatedRequestId);
  if (!input) {
    invalidFormRedirect(
      form,
      generatedRequestId,
      "review_draft",
      "student_case_contract_draft_id",
    );
  }
  const retry = {
    requestId: input.requestId,
    operation: "review_draft",
    subjectId: input.studentCaseContractDraftId,
  } as const;
  const workspace = await workspaceOrRedirect(actor, input.studentCaseId, retry);
  if (
    !workspace.canReviewContract ||
    !workspace.drafts.some(
      (draft) =>
        draft.studentCaseContractDraftId === input.studentCaseContractDraftId &&
        draft.status === "draft",
    )
  ) {
    mutationRedirect(input.studentCaseId, "not_allowed");
  }
  const response = await callRpc("review_student_case_contract_draft", {
    p_organization_id: actor.organizationId,
    p_student_case_id: input.studentCaseId,
    p_student_case_contract_draft_id: input.studentCaseContractDraftId,
    p_decision: input.decision,
    p_reason: input.reason,
    p_request_id: input.requestId,
  });
  if (response.error) {
    mutationRedirect(input.studentCaseId, mutationErrorOutcome(response.error), retry);
  }
  try {
    const row = requireBaseResponse(
      response.data,
      [
        "organization_id",
        "student_case_id",
        "student_case_contract_draft_id",
        "contract_template_version_id",
        "version",
        "decision",
        "status",
        "input_sha256",
        "rendered_sha256",
        "actor_membership_id",
        "mutation_sha256",
      ],
      actor.organizationId,
      actor.membershipId,
    );
    if (
      platformContractResponseValidators.requiredUuid(row.student_case_id) !==
        input.studentCaseId ||
      platformContractResponseValidators.requiredUuid(
        row.student_case_contract_draft_id,
      ) !== input.studentCaseContractDraftId ||
      row.decision !== input.decision ||
      row.status !== input.decision ||
      !PLATFORM_CONTRACT_REVIEW_DECISIONS.includes(
        row.decision as (typeof PLATFORM_CONTRACT_REVIEW_DECISIONS)[number],
      )
    ) {
      throw new Error("Invalid BW6 draft review response");
    }
    platformContractResponseValidators.requiredUuid(row.contract_template_version_id);
    platformContractResponseValidators.positiveInteger(row.version);
    platformContractResponseValidators.sha256(row.input_sha256);
    platformContractResponseValidators.sha256(row.rendered_sha256);
    platformContractResponseValidators.sha256(row.mutation_sha256);
  } catch {
    mutationRedirect(input.studentCaseId, "unavailable", retry);
  }
  revalidatePath(`/clients/${input.studentCaseId}`);
  mutationRedirect(
    input.studentCaseId,
    input.decision === "approved" ? "draft_approved" : "draft_rejected",
  );
}

export async function seedPlatformPostContractItemsAction(
  form: FormData,
): Promise<void> {
  const actor = await requirePlatformClientsActor();
  const generatedRequestId = randomUUID();
  const input = parsePlatformTemplateLifecycleForm(form, generatedRequestId);
  if (!input) {
    invalidFormRedirect(
      form,
      generatedRequestId,
      "seed_items",
      "contract_template_version_id",
    );
  }
  const retry = {
    requestId: input.requestId,
    operation: "seed_items",
    subjectId: input.contractTemplateVersionId,
  } as const;
  const workspace = await workspaceOrRedirect(actor, input.studentCaseId, retry);
  if (
    !workspace.canManagePostContract ||
    !workspace.templates.some(
      (template) =>
        template.contractTemplateVersionId === input.contractTemplateVersionId &&
        template.status === "approved",
    )
  ) {
    mutationRedirect(input.studentCaseId, "not_allowed");
  }
  const response = await callRpc("seed_post_contract_items", {
    p_organization_id: actor.organizationId,
    p_student_case_id: input.studentCaseId,
    p_contract_template_version_id: input.contractTemplateVersionId,
    p_reason: input.reason,
    p_request_id: input.requestId,
  });
  if (response.error) {
    mutationRedirect(input.studentCaseId, mutationErrorOutcome(response.error), retry);
  }
  try {
    const row = requireBaseResponse(
      response.data,
      [
        "organization_id",
        "student_case_id",
        "contract_template_version_id",
        "seeded_item_count",
        "existing_item_count",
        "total_item_count",
        "actor_membership_id",
        "input_sha256",
      ],
      actor.organizationId,
      actor.membershipId,
    );
    if (
      platformContractResponseValidators.requiredUuid(row.student_case_id) !==
        input.studentCaseId ||
      platformContractResponseValidators.requiredUuid(
        row.contract_template_version_id,
      ) !== input.contractTemplateVersionId
    ) {
      throw new Error("Invalid BW6 seed response");
    }
    const seeded = platformContractResponseValidators.nonNegativeInteger(
      row.seeded_item_count,
    );
    const existing = platformContractResponseValidators.nonNegativeInteger(
      row.existing_item_count,
    );
    const total = platformContractResponseValidators.nonNegativeInteger(
      row.total_item_count,
    );
    if (seeded + existing !== total) throw new Error("Invalid BW6 item counts");
    platformContractResponseValidators.sha256(row.input_sha256);
  } catch {
    mutationRedirect(input.studentCaseId, "unavailable", retry);
  }
  revalidatePath(`/clients/${input.studentCaseId}`);
  mutationRedirect(input.studentCaseId, "items_seeded");
}

export async function updatePlatformPostContractItemAction(
  form: FormData,
): Promise<void> {
  const actor = await requirePlatformClientsActor();
  const generatedRequestId = randomUUID();
  const input = parsePlatformUpdatePostContractItemForm(form, generatedRequestId);
  if (!input) {
    invalidFormRedirect(
      form,
      generatedRequestId,
      "update_item",
      "post_contract_item_id",
    );
  }
  const retry = {
    requestId: input.requestId,
    operation: "update_item",
    subjectId: input.postContractItemId,
  } as const;
  const workspace = await workspaceOrRedirect(actor, input.studentCaseId, retry);
  const item = workspace.items.find(
    (candidate) => candidate.postContractItemId === input.postContractItemId,
  );
  if (
    !workspace.canManagePostContract ||
    !item ||
    item.revision !== input.expectedRevision
  ) {
    mutationRedirect(input.studentCaseId, "not_allowed");
  }
  const response = await callRpc("update_post_contract_item", {
    p_organization_id: actor.organizationId,
    p_student_case_id: input.studentCaseId,
    p_post_contract_item_id: input.postContractItemId,
    p_expected_revision: input.expectedRevision,
    p_status: input.status,
    p_owner_membership_id: input.ownerMembershipId,
    p_next_action: input.nextAction,
    p_evidence_ref: input.evidenceRef,
    p_reason: input.reason,
    p_request_id: input.requestId,
  });
  if (response.error) {
    mutationRedirect(input.studentCaseId, mutationErrorOutcome(response.error), retry);
  }
  try {
    const row = requireBaseResponse(
      response.data,
      [
        "organization_id",
        "student_case_id",
        "post_contract_item_id",
        "status",
        "owner_role",
        "owner_membership_id",
        "next_action",
        "evidence_ref",
        "revision",
        "actor_membership_id",
        "input_sha256",
      ],
      actor.organizationId,
      actor.membershipId,
    );
    if (
      platformContractResponseValidators.requiredUuid(row.student_case_id) !==
        input.studentCaseId ||
      platformContractResponseValidators.requiredUuid(row.post_contract_item_id) !==
        input.postContractItemId ||
      platformContractResponseValidators.requiredUuid(row.owner_membership_id) !==
        input.ownerMembershipId ||
      row.status !== input.status ||
      !PLATFORM_POST_CONTRACT_ITEM_STATUSES.includes(
        row.status as (typeof PLATFORM_POST_CONTRACT_ITEM_STATUSES)[number],
      ) ||
      platformContractResponseValidators.positiveInteger(row.revision) !==
        input.expectedRevision + 1
    ) {
      throw new Error("Invalid BW6 item response");
    }
    if (row.owner_role !== "admin" && row.owner_role !== "curator") {
      throw new Error("Invalid BW6 item owner");
    }
    if (row.next_action !== input.nextAction || row.evidence_ref !== input.evidenceRef) {
      throw new Error("Invalid BW6 item content");
    }
    platformContractResponseValidators.sha256(row.input_sha256);
  } catch {
    mutationRedirect(input.studentCaseId, "unavailable", retry);
  }
  revalidatePath(`/clients/${input.studentCaseId}`);
  mutationRedirect(input.studentCaseId, "item_updated");
}

function validateReportResponse(
  value: unknown,
  expected: Readonly<{
    organizationId: string;
    actorMembershipId: string;
    studentCaseId: string;
    contractTemplateVersionId: string;
    reportId?: string;
    decision?: "approved" | "rejected";
  }>,
): string {
  const reviewKeys = expected.decision ? ["decision"] : [];
  const row = requireBaseResponse(
    value,
    [
      "organization_id",
      "student_case_id",
      "contract_template_version_id",
      "post_contract_report_id",
      "version",
      ...reviewKeys,
      "status",
      "total_item_count",
      "delivered_item_count",
      "open_item_count",
      "in_progress_item_count",
      "blocked_item_count",
      "report_sha256",
      "actor_membership_id",
      "input_sha256",
    ],
    expected.organizationId,
    expected.actorMembershipId,
  );
  const reportId = platformContractResponseValidators.requiredUuid(
    row.post_contract_report_id,
  );
  if (
    platformContractResponseValidators.requiredUuid(row.student_case_id) !==
      expected.studentCaseId ||
    platformContractResponseValidators.requiredUuid(
      row.contract_template_version_id,
    ) !== expected.contractTemplateVersionId ||
    (expected.reportId && reportId !== expected.reportId) ||
    row.status !== (expected.decision ?? "draft") ||
    (expected.decision && row.decision !== expected.decision)
  ) {
    throw new Error("Invalid BW6 report response");
  }
  platformContractResponseValidators.positiveInteger(row.version);
  const total = platformContractResponseValidators.nonNegativeInteger(
    row.total_item_count,
  );
  const delivered = platformContractResponseValidators.nonNegativeInteger(
    row.delivered_item_count,
  );
  const open = platformContractResponseValidators.nonNegativeInteger(row.open_item_count);
  const inProgress = platformContractResponseValidators.nonNegativeInteger(
    row.in_progress_item_count,
  );
  const blocked = platformContractResponseValidators.nonNegativeInteger(
    row.blocked_item_count,
  );
  if (delivered + open + inProgress + blocked !== total) {
    throw new Error("Invalid BW6 report counts");
  }
  platformContractResponseValidators.sha256(row.report_sha256);
  platformContractResponseValidators.sha256(row.input_sha256);
  return reportId;
}

export async function generatePlatformPostContractReportAction(
  form: FormData,
): Promise<void> {
  const actor = await requirePlatformClientsActor();
  const generatedRequestId = randomUUID();
  const input = parsePlatformGeneratePostContractReportForm(form, generatedRequestId);
  if (!input) {
    invalidFormRedirect(
      form,
      generatedRequestId,
      "generate_report",
      "contract_template_version_id",
    );
  }
  const retry = {
    requestId: input.requestId,
    operation: "generate_report",
    subjectId: input.contractTemplateVersionId,
  } as const;
  const workspace = await workspaceOrRedirect(actor, input.studentCaseId, retry);
  if (
    !workspace.canManagePostContract ||
    !workspace.items.some(
      (item) =>
        item.contractTemplateVersionId === input.contractTemplateVersionId,
    )
  ) {
    mutationRedirect(input.studentCaseId, "not_allowed");
  }
  const response = await callRpc("generate_post_contract_report", {
    p_organization_id: actor.organizationId,
    p_student_case_id: input.studentCaseId,
    p_contract_template_version_id: input.contractTemplateVersionId,
    p_reason: input.reason,
    p_request_id: input.requestId,
  });
  if (response.error) {
    mutationRedirect(input.studentCaseId, mutationErrorOutcome(response.error), retry);
  }
  try {
    validateReportResponse(response.data, {
      organizationId: actor.organizationId,
      actorMembershipId: actor.membershipId,
      studentCaseId: input.studentCaseId,
      contractTemplateVersionId: input.contractTemplateVersionId,
    });
  } catch {
    mutationRedirect(input.studentCaseId, "unavailable", retry);
  }
  revalidatePath(`/clients/${input.studentCaseId}`);
  mutationRedirect(input.studentCaseId, "report_generated");
}

export async function reviewPlatformPostContractReportAction(
  form: FormData,
): Promise<void> {
  const actor = await requirePlatformClientsActor();
  const generatedRequestId = randomUUID();
  const input = parsePlatformReviewPostContractReportForm(form, generatedRequestId);
  if (!input) {
    invalidFormRedirect(
      form,
      generatedRequestId,
      "review_report",
      "post_contract_report_id",
    );
  }
  const retry = {
    requestId: input.requestId,
    operation: "review_report",
    subjectId: input.postContractReportId,
  } as const;
  const workspace = await workspaceOrRedirect(actor, input.studentCaseId, retry);
  const report = workspace.reports.find(
    (candidate) => candidate.postContractReportId === input.postContractReportId,
  );
  if (
    !workspace.canReviewReport ||
    !report ||
    report.status !== "draft"
  ) {
    mutationRedirect(input.studentCaseId, "not_allowed");
  }
  const response = await callRpc("review_post_contract_report", {
    p_organization_id: actor.organizationId,
    p_student_case_id: input.studentCaseId,
    p_post_contract_report_id: input.postContractReportId,
    p_decision: input.decision,
    p_reason: input.reason,
    p_request_id: input.requestId,
  });
  if (response.error) {
    mutationRedirect(input.studentCaseId, mutationErrorOutcome(response.error), retry);
  }
  try {
    validateReportResponse(response.data, {
      organizationId: actor.organizationId,
      actorMembershipId: actor.membershipId,
      studentCaseId: input.studentCaseId,
      contractTemplateVersionId: report.contractTemplateVersionId,
      reportId: input.postContractReportId,
      decision: input.decision,
    });
  } catch {
    mutationRedirect(input.studentCaseId, "unavailable", retry);
  }
  revalidatePath(`/clients/${input.studentCaseId}`);
  mutationRedirect(
    input.studentCaseId,
    input.decision === "approved" ? "report_approved" : "report_rejected",
  );
}
