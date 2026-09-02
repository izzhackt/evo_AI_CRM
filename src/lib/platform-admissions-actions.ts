"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  buildPlatformAdmissionsRedirectUrl,
  parsePlatformAdmissionsUuid,
} from "./platform-admissions";
import {
  PLATFORM_APPLICATION_EVIDENCE_STATUSES,
  PLATFORM_APPLICATION_STATUSES,
  type PlatformApplicationStatus,
} from "./platform-application-contract.ts";
import {
  requirePlatformApplicationsActor,
  requirePlatformClientsActor,
} from "./platform-guards";
import {
  createSupabaseServerClient,
} from "./supabase/server";

const CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

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

function applicationStatus(value: string): PlatformApplicationStatus | null {
  return (PLATFORM_APPLICATION_STATUSES as readonly string[]).includes(value)
    ? (value as PlatformApplicationStatus)
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeRedirect(
  path: string,
  outcome: "saved" | "invalid" | "unavailable",
  retryRequestId?: string | null,
  anchor?: "case-lifecycle" | "applications",
): never {
  redirect(
    buildPlatformAdmissionsRedirectUrl(
      path,
      outcome,
      retryRequestId,
      anchor,
    ),
  );
}

function applicationRedirect(
  path: string,
  outcome: "saved" | "invalid" | "unavailable",
  operation: "create" | "change",
  retryRequestId?: string | null,
  retrySubjectId?: string | null,
  anchor?: "applications",
): never {
  const params = new URLSearchParams({ application_result: outcome });
  if (outcome !== "saved" && retryRequestId) {
    params.set("application_retry_request_id", retryRequestId);
    params.set("application_retry_operation", operation);
    if (retrySubjectId) {
      params.set("application_retry_subject_id", retrySubjectId);
    }
  }
  redirect(`${path}?${params.toString()}${anchor ? `#${anchor}` : ""}`);
}

export async function changePlatformStudentCaseStateAction(
  form: FormData,
): Promise<void> {
  const actor = await requirePlatformClientsActor();
  const studentCaseId = requiredUuid(form, "student_case_id");
  const requestId = requiredUuid(form, "request_id");
  const newStateValue = value(form, "new_state");
  const reason = boundedText(form, "reason", 3, 1000);
  const targetPath = studentCaseId
    ? `/clients/${studentCaseId}`
    : "/clients";

  if (
    (actor.platformRole !== "admin" && actor.platformRole !== "admissions") ||
    !studentCaseId ||
    !requestId ||
    (newStateValue !== "active" && newStateValue !== "closed") ||
    !reason
  ) {
    safeRedirect(targetPath, "invalid", requestId, "case-lifecycle");
  }

  try {
    const client = await createSupabaseServerClient();
    const response = await client.schema("platform").rpc(
      "change_student_case_state",
      {
        p_organization_id: actor.organizationId,
        p_student_case_id: studentCaseId,
        p_new_state: newStateValue,
        p_reason: reason,
        p_request_id: requestId,
      },
    );
    if (
      response.error ||
      !isRecord(response.data) ||
      parsePlatformAdmissionsUuid(response.data.organization_id) !==
        actor.organizationId ||
      parsePlatformAdmissionsUuid(response.data.student_case_id) !==
        studentCaseId ||
      response.data.case_state !== newStateValue
    ) {
      safeRedirect(targetPath, "unavailable", requestId, "case-lifecycle");
    }
  } catch {
    safeRedirect(targetPath, "unavailable", requestId, "case-lifecycle");
  }

  revalidatePath("/clients");
  revalidatePath(targetPath);
  revalidatePath("/applications");
  safeRedirect(targetPath, "saved", null, "case-lifecycle");
}

export async function assignPlatformStudentCaseCuratorAction(
  form: FormData,
): Promise<void> {
  const actor = await requirePlatformClientsActor();
  const studentCaseId = requiredUuid(form, "client_id");
  const curatorMembershipId = requiredUuid(form, "curator_id");
  const requestId = requiredUuid(form, "request_id");
  const reason = boundedText(form, "reason", 1, 1000);
  const targetPath = studentCaseId
    ? `/clients/${studentCaseId}`
    : "/clients";

  if (
    actor.platformRole !== "admin"
    || !studentCaseId
    || !curatorMembershipId
    || !requestId
    || !reason
  ) {
    safeRedirect(targetPath, "invalid", requestId);
  }

  try {
    const client = await createSupabaseServerClient();
    const response = await client.schema("platform").rpc(
      "assign_student_case_curator",
      {
        p_organization_id: actor.organizationId,
        p_student_case_id: studentCaseId,
        p_curator_membership_id: curatorMembershipId,
        p_reason: reason,
        p_request_id: requestId,
      },
    );
    const portalActivatedAt = isRecord(response.data)
      ? response.data.portal_activated_at
      : null;
    if (
      response.error
      || !isRecord(response.data)
      || parsePlatformAdmissionsUuid(response.data.organization_id) !==
        actor.organizationId
      || parsePlatformAdmissionsUuid(response.data.student_case_id) !==
        studentCaseId
      || parsePlatformAdmissionsUuid(response.data.curator_membership_id) !==
        curatorMembershipId
      || (response.data.case_state !== "active"
        && response.data.case_state !== "closed")
      || typeof portalActivatedAt !== "string"
      || !Number.isFinite(Date.parse(portalActivatedAt))
    ) {
      safeRedirect(targetPath, "unavailable", requestId);
    }
  } catch {
    safeRedirect(targetPath, "unavailable", requestId);
  }

  revalidatePath("/clients");
  revalidatePath(targetPath);
  revalidatePath("/applications");
  revalidatePath("/portal", "layout");
  safeRedirect(targetPath, "saved");
}

export async function updatePlatformStudentCaseRouteAction(
  form: FormData,
): Promise<void> {
  const actor = await requirePlatformClientsActor();
  const studentCaseId = requiredUuid(form, "student_case_id");
  const requestId = requiredUuid(form, "request_id");
  const targetPath = studentCaseId ? `/clients/${studentCaseId}` : "/clients";
  const targetCountry = boundedText(form, "target_country", 1, 120);
  const targetDegree = boundedText(form, "target_degree", 1, 160);
  const programDirection = boundedText(form, "program_direction", 1, 200);
  const intake = optionalBoundedText(form, "intake", 200);
  const languageAssumption = optionalBoundedText(
    form,
    "language_assumption",
    200,
  );
  const fundingAssumption = optionalBoundedText(
    form,
    "funding_assumption",
    300,
  );
  const operationalStage = boundedText(form, "operational_stage", 1, 200);
  const nextAction = optionalBoundedText(form, "next_action", 1000);
  const reason = boundedText(form, "reason", 3, 500);

  if (
    !studentCaseId ||
    !requestId ||
    !targetCountry ||
    !targetDegree ||
    !programDirection ||
    intake === undefined ||
    languageAssumption === undefined ||
    fundingAssumption === undefined ||
    !operationalStage ||
    nextAction === undefined ||
    !reason
  ) {
    safeRedirect(targetPath, "invalid", requestId);
  }

  try {
    const client = await createSupabaseServerClient();
    const response = await client.schema("platform").rpc(
      "set_student_case_route",
      {
        p_organization_id: actor.organizationId,
        p_student_case_id: studentCaseId,
        p_target_country: targetCountry,
        p_target_degree: targetDegree,
        p_program_direction: programDirection,
        p_intake: intake,
        p_language_assumption: languageAssumption,
        p_funding_assumption: fundingAssumption,
        // Any route edit re-enters review; the browser cannot preserve an old
        // approval for materially changed route data.
        p_route_approval_status: "draft",
        p_operational_stage: operationalStage,
        p_next_action: nextAction,
        p_reason: reason,
        p_request_id: requestId,
      },
    );
    if (
      response.error ||
      !isRecord(response.data) ||
      parsePlatformAdmissionsUuid(response.data.organization_id) !==
        actor.organizationId ||
      parsePlatformAdmissionsUuid(response.data.student_case_id) !==
        studentCaseId ||
      response.data.program_direction !== programDirection ||
      response.data.route_approval_status !== "draft"
    ) {
      safeRedirect(targetPath, "unavailable", requestId);
    }
  } catch {
    safeRedirect(targetPath, "unavailable", requestId);
  }

  revalidatePath("/clients");
  revalidatePath(targetPath);
  revalidatePath("/applications");
  safeRedirect(targetPath, "saved");
}

export async function createPlatformUniversityApplicationAction(
  form: FormData,
): Promise<void> {
  const actor = await requirePlatformApplicationsActor();
  const studentCaseId = requiredUuid(form, "student_case_id");
  const requestId = requiredUuid(form, "request_id");
  const returnToCaseValue = value(form, "return_to_case");
  const returnToCase = returnToCaseValue === "1";
  const targetPath = returnToCase && studentCaseId
    ? `/clients/${studentCaseId}`
    : "/applications";
  const targetAnchor = returnToCase ? "applications" as const : undefined;
  const catalogInstitutionValue = value(form, "catalog_institution_id");
  const catalogInstitutionId = catalogInstitutionValue
    ? parsePlatformAdmissionsUuid(catalogInstitutionValue)
    : null;
  const institutionName = boundedText(form, "institution_name", 1, 300);
  const programName = boundedText(form, "program_name", 1, 300);
  const status = applicationStatus(value(form, "status"));
  const evidence = optionalBoundedText(form, "evidence_reference", 1000);
  const note = optionalBoundedText(form, "note", 1000);

  if (
    !studentCaseId ||
    !requestId ||
    (returnToCaseValue !== "" && !returnToCase) ||
    (catalogInstitutionValue !== "" && !catalogInstitutionId) ||
    (!catalogInstitutionId && !institutionName) ||
    !programName ||
    !status ||
    evidence === undefined ||
    note === undefined ||
    (PLATFORM_APPLICATION_EVIDENCE_STATUSES.has(status) && !evidence)
  ) {
    applicationRedirect(
      targetPath,
      "invalid",
      "create",
      requestId,
      null,
      targetAnchor,
    );
  }

  try {
    const client = await createSupabaseServerClient();
    const response = catalogInstitutionId
      ? await client.schema("platform").rpc(
          "create_catalog_university_application",
          {
            p_organization_id: actor.organizationId,
            p_student_case_id: studentCaseId,
            p_catalog_institution_id: catalogInstitutionId,
            p_program_name: programName,
            p_status: status,
            p_evidence_reference: evidence,
            p_note: note,
            p_request_id: requestId,
          },
        )
      : await client.schema("platform").rpc(
          "create_university_application",
          {
            p_organization_id: actor.organizationId,
            p_student_case_id: studentCaseId,
            p_institution_name: institutionName,
            p_program_name: programName,
            p_status: status,
            p_evidence_reference: evidence,
            p_note: note,
            p_request_id: requestId,
          },
        );
    if (
      response.error ||
      !isRecord(response.data) ||
      parsePlatformAdmissionsUuid(response.data.organization_id) !==
        actor.organizationId ||
      parsePlatformAdmissionsUuid(response.data.student_case_id) !==
        studentCaseId ||
      parsePlatformAdmissionsUuid(
        response.data.university_application_id,
      ) === null ||
      (catalogInstitutionId !== null &&
        parsePlatformAdmissionsUuid(response.data.catalog_institution_id) !==
          catalogInstitutionId) ||
      response.data.status !== status
    ) {
      applicationRedirect(
        targetPath,
        "unavailable",
        "create",
        requestId,
        null,
        targetAnchor,
      );
    }
  } catch {
    applicationRedirect(
      targetPath,
      "unavailable",
      "create",
      requestId,
      null,
      targetAnchor,
    );
  }

  revalidatePath("/applications");
  revalidatePath(`/clients/${studentCaseId}`);
  applicationRedirect(targetPath, "saved", "create", null, null, targetAnchor);
}

export async function changePlatformUniversityApplicationAction(
  form: FormData,
): Promise<void> {
  const actor = await requirePlatformApplicationsActor();
  const applicationId = requiredUuid(form, "application_id");
  const requestId = requiredUuid(form, "request_id");
  const returnToCaseValue = value(form, "return_to_case");
  const returnToCase = returnToCaseValue === "1";
  const studentCaseId = returnToCase
    ? requiredUuid(form, "student_case_id")
    : null;
  const status = applicationStatus(value(form, "status"));
  const evidence = optionalBoundedText(form, "evidence_reference", 1000);
  const note = optionalBoundedText(form, "note", 1000);
  const targetPath = returnToCase && studentCaseId
    ? `/clients/${studentCaseId}`
    : applicationId
      ? `/applications/${applicationId}`
      : "/applications";
  const targetAnchor = returnToCase ? "applications" as const : undefined;

  if (
    !applicationId ||
    !requestId ||
    (returnToCaseValue !== "" && !returnToCase) ||
    (returnToCase && !studentCaseId) ||
    !status ||
    evidence === undefined ||
    note === undefined ||
    (PLATFORM_APPLICATION_EVIDENCE_STATUSES.has(status) && !evidence)
  ) {
    applicationRedirect(
      targetPath,
      "invalid",
      "change",
      requestId,
      applicationId,
      targetAnchor,
    );
  }

  try {
    const client = await createSupabaseServerClient();
    const response = await client.schema("platform").rpc(
      "change_university_application",
      {
        p_organization_id: actor.organizationId,
        p_application_id: applicationId,
        p_new_status: status,
        p_evidence_reference: evidence,
        p_note: note,
        p_request_id: requestId,
      },
    );
    if (
      response.error ||
      !isRecord(response.data) ||
      parsePlatformAdmissionsUuid(response.data.organization_id) !==
        actor.organizationId ||
      parsePlatformAdmissionsUuid(
        response.data.university_application_id,
      ) !== applicationId ||
      (returnToCase &&
        parsePlatformAdmissionsUuid(response.data.student_case_id) !==
          studentCaseId) ||
      response.data.status !== status
    ) {
      applicationRedirect(
        targetPath,
        "unavailable",
        "change",
        requestId,
        applicationId,
        targetAnchor,
      );
    }
  } catch {
    applicationRedirect(
      targetPath,
      "unavailable",
      "change",
      requestId,
      applicationId,
      targetAnchor,
    );
  }

  revalidatePath("/applications");
  if (studentCaseId) revalidatePath(`/clients/${studentCaseId}`);
  revalidatePath(targetPath);
  applicationRedirect(targetPath, "saved", "change", null, null, targetAnchor);
}
