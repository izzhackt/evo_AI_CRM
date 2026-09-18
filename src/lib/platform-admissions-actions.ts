"use server";

import { isStaffPreview, staffHasPermission } from "./platform-access.ts";
import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import {
  getPlatformApplication,
  parsePlatformAdmissionsUuid,
} from "./platform-admissions";
import {
  isPlatformApplicationCountryCode,
  isPlatformApplicationDegreeValue,
  parsePlatformApplicationCountryInput,
  parsePlatformApplicationCountryDetailsInput,
  parsePlatformApplicationDeadlineInput,
  parsePlatformApplicationDegreeDetailsInput,
  parsePlatformApplicationDegreeInput,
  parsePlatformApplicationDetailsReceipt,
  parsePlatformApplicationPrimaryCheckbox,
  PLATFORM_APPLICATION_EVIDENCE_STATUSES,
  PLATFORM_APPLICATION_STATUSES,
  parsePlatformApplicationSwitchMetadata,
  type PlatformApplicationStatus,
} from "./platform-application-contract.ts";
import { requirePlatformStaffActor } from "./platform-guards";
import { parseUniversityFilters } from "./platform-university-catalog";
import { readStaffUniversities } from "./v3/university-source";
import type {
  PlatformAdmissionsActionStatus,
} from "./platform-admissions-task-actions";
import { exactActionStringFields } from "./server/action-form-fields";
import {
  createSupabaseServerClient,
} from "./supabase/server";

const CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const POSTGRES_BIGINT_MAX = "9223372036854775807";
const TIMESTAMPTZ_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const CREATE_APPLICATION_FIELDS = [
  "student_case_id",
  "catalog_institution_id",
  "institution_name",
  "program_name",
  "status",
  "evidence_reference",
  "note",
  "is_primary",
  "university_deadline_on",
  "country",
  "degree",
  "request_id",
  "expected_version",
] as const;
const UPDATE_APPLICATION_DETAILS_FIELDS = [
  "application_id",
  "is_primary",
  "university_deadline_on",
  "country",
  "degree",
  "request_id",
  "expected_version",
] as const;
const CHANGE_APPLICATION_FIELDS = [
  "application_id",
  "student_case_id",
  "status",
  "evidence_reference",
  "note",
  "request_id",
  "expected_version",
] as const;
/** «Партнёр и решение» (unified workflow S7): partner_contact/external_link/decision_reference/decision_note. */
const PARTNER_DETAILS_FIELDS = [
  "application_id",
  "student_case_id",
  "request_id",
  "expected_version",
  "partner_contact",
  "external_link",
  "decision_reference",
  "decision_note",
] as const;
const HTTPS_LINK_PATTERN = /^https:\/\/[^\s<>"]{1,1990}$/;

export type PlatformUniversityApplicationActionState = Readonly<{
  status: PlatformAdmissionsActionStatus;
  requestId: string;
  universityApplicationId: string | null;
  version: string | null;
}>;

function applicationStatus(value: string): PlatformApplicationStatus | null {
  return (PLATFORM_APPLICATION_STATUSES as readonly string[]).includes(value)
    ? (value as PlatformApplicationStatus)
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type ApplicationUniversitySearchResult = Readonly<{
  status: "ready" | "invalid" | "forbidden" | "unavailable";
  items: readonly Readonly<{ id: string; name: string; country: string }>[];
  nextOffset: number | null;
}>;

export async function searchApplicationUniversitiesAction(
  input: unknown,
): Promise<ApplicationUniversitySearchResult> {
  const actor = await requirePlatformStaffActor();
  if (isStaffPreview(actor) || !staffHasPermission(actor, "catalog.read") ||
      !staffHasPermission(actor, "application.manage")) {
    return { status: "forbidden", items: [], nextOffset: null };
  }
  if (!isRecord(input) || Object.keys(input).length !== 2 ||
      Object.keys(input).some((key) => key !== "query" && key !== "offset") ||
      typeof input.query !== "string" || input.query.length > 100 ||
      typeof input.offset !== "number" || !Number.isSafeInteger(input.offset) ||
      input.offset < 0 || input.offset > 50_000) {
    return { status: "invalid", items: [], nextOffset: null };
  }
  const filters = parseUniversityFilters({ q: input.query, offset: String(input.offset) });
  if (!filters) return { status: "invalid", items: [], nextOffset: null };
  try {
    const page = await readStaffUniversities(actor, filters);
    return {
      status: "ready",
      items: page.items.map(({ id, content }) => ({
        id, name: content.name, country: content.country,
      })),
      nextOffset: page.nextOffset,
    };
  } catch {
    return { status: "unavailable", items: [], nextOffset: null };
  }
}

type ApplicationStringFields = ReadonlyMap<string, string>;

function applicationField(
  fields: ApplicationStringFields,
  key: string,
): string {
  return fields.get(key)?.trim() ?? "";
}

function rawApplicationField(
  fields: ApplicationStringFields,
  key: string,
): string {
  return fields.get(key) ?? "";
}

function applicationUuid(value: string): string | null {
  return parsePlatformAdmissionsUuid(value);
}

function applicationText(
  value: string,
  minimum: number,
  maximum: number,
): string | null {
  const normalized = value.trim();
  if (
    normalized.length < minimum ||
    normalized.length > maximum ||
    CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function optionalApplicationText(
  value: string,
  maximum: number,
): string | null | undefined {
  if (!value.trim()) return null;
  return applicationText(value, 1, maximum) ?? undefined;
}

function exactApplicationFields(
  form: FormData,
  expectedFields: readonly string[],
): ApplicationStringFields | null {
  if (!expectedFields.includes("is_primary")) {
    return exactActionStringFields(form, expectedFields);
  }
  const entries = [...form.entries()];
  const usesActionStateEnvelope = entries.some(([key]) => key.startsWith("_1_"));
  const checkboxKey = usesActionStateEnvelope ? "_1_is_primary" : "is_primary";
  if (entries.some(([key]) => key === checkboxKey)) {
    return exactActionStringFields(form, expectedFields);
  }
  const normalized = new FormData();
  for (const [key, value] of entries) normalized.append(key, value);
  normalized.append(checkboxKey, "");
  return exactActionStringFields(normalized, expectedFields);
}

function validApplicationSwitchMetadata(
  value: unknown,
  targetApplicationId: string,
  isPrimary: boolean,
): boolean {
  const metadata = parsePlatformApplicationSwitchMetadata(
    value,
    targetApplicationId,
  );
  return metadata !== undefined &&
    (isPrimary || metadata.demotedPrimaryApplicationId === null);
}

function validApplicationChangedAt(value: unknown): boolean {
  return typeof value === "string" && TIMESTAMPTZ_PATTERN.test(value) &&
    Number.isFinite(Date.parse(value));
}

function applicationVersion(value: string, allowZero: boolean): string | null {
  if (!/^\d+$/.test(value)) return null;
  const normalized = value.replace(/^0+(?=\d)/, "");
  if (
    (!allowZero && normalized === "0") ||
    normalized.length > POSTGRES_BIGINT_MAX.length ||
    (normalized.length === POSTGRES_BIGINT_MAX.length &&
      normalized > POSTGRES_BIGINT_MAX)
  ) {
    return null;
  }
  return normalized;
}

function submittedApplicationRequestId(form: FormData): string | null {
  const direct = form.getAll("request_id");
  const enveloped = form.getAll("_1_request_id");
  const values = direct.length > 0 ? direct : enveloped;
  const candidate = values.length === 1 ? values[0] : null;
  return typeof candidate === "string"
    ? applicationUuid(candidate.trim())
    : null;
}

function applicationErrorStatus(error: unknown): Exclude<
  PlatformAdmissionsActionStatus,
  "idle" | "saved"
> {
  if (!isRecord(error)) return "unavailable";
  const code = typeof error.code === "string" ? error.code : "";
  const message = typeof error.message === "string"
    ? error.message.trim()
    : "";
  if (code === "42501") return "forbidden";
  if (
    code === "PT409" &&
    message === "admissions_version_conflict"
  ) {
    return "stale";
  }
  if ((code === "22023" || code === "23505") && /request_id/i.test(message)) {
    return "request_conflict";
  }
  if (code === "22023") return "invalid";
  return "unavailable";
}

function applicationFailureState(
  form: FormData,
  status: Exclude<PlatformAdmissionsActionStatus, "idle" | "saved">,
  universityApplicationId: string | null = null,
  verifiedRequestId?: string | null,
): PlatformUniversityApplicationActionState {
  const requestId = verifiedRequestId ?? submittedApplicationRequestId(form);
  return Object.freeze({
    status,
    requestId: status === "stale" || status === "request_conflict"
      ? randomUUID()
      : (requestId ?? randomUUID()),
    universityApplicationId,
    version: null,
  });
}

function revalidateApplication(studentCaseId: string): void {
  void studentCaseId;
  revalidatePath("/v3/calendar");
  revalidatePath("/v3/profile");
}

export async function createPlatformUniversityApplicationAction(
  _previous: PlatformUniversityApplicationActionState,
  form: FormData,
): Promise<PlatformUniversityApplicationActionState> {
  const actor = await requirePlatformStaffActor();
  if (isStaffPreview(actor) || !staffHasPermission(actor, "application.manage")) {
    return applicationFailureState(form, "forbidden");
  }
  const fields = exactApplicationFields(form, CREATE_APPLICATION_FIELDS);
  if (!fields) return applicationFailureState(form, "invalid");

  const studentCaseId = applicationUuid(applicationField(fields, "student_case_id"));
  const requestId = applicationUuid(applicationField(fields, "request_id"));
  const expectedVersion = applicationVersion(
    applicationField(fields, "expected_version"),
    true,
  );
  const catalogValue = applicationField(fields, "catalog_institution_id");
  const catalogInstitutionId = catalogValue
    ? applicationUuid(catalogValue)
    : null;
  const institutionValue = applicationField(fields, "institution_name");
  const institutionName = institutionValue
    ? applicationText(institutionValue, 1, 300)
    : null;
  const programName = applicationText(
    applicationField(fields, "program_name"),
    1,
    300,
  );
  const status = applicationStatus(applicationField(fields, "status"));
  const evidence = optionalApplicationText(
    applicationField(fields, "evidence_reference"),
    1_000,
  );
  const note = optionalApplicationText(applicationField(fields, "note"), 1_000);
  const isPrimary = parsePlatformApplicationPrimaryCheckbox(
    rawApplicationField(fields, "is_primary"),
  );
  const universityDeadlineOn = parsePlatformApplicationDeadlineInput(
    rawApplicationField(fields, "university_deadline_on"),
  );
  const country = parsePlatformApplicationCountryInput(
    applicationField(fields, "country"),
  );
  const degree = parsePlatformApplicationDegreeInput(
    applicationField(fields, "degree"),
  );
  if (
    !studentCaseId || !requestId || expectedVersion !== "0" ||
    (catalogValue !== "" && !catalogInstitutionId) ||
    (!catalogInstitutionId && !institutionName) || !programName || !status ||
    evidence === undefined || note === undefined || isPrimary === null ||
    universityDeadlineOn === undefined ||
    country === undefined || degree === undefined ||
    (PLATFORM_APPLICATION_EVIDENCE_STATUSES.has(status) && !evidence) ||
    ((status === "rejected" || status === "withdrawn") && !note)
  ) {
    return applicationFailureState(form, "invalid", null, requestId);
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
            p_is_primary: isPrimary,
            p_university_deadline_on: universityDeadlineOn,
            p_country: country,
            p_degree: degree,
            p_expected_version: expectedVersion,
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
            p_is_primary: isPrimary,
            p_university_deadline_on: universityDeadlineOn,
            p_country: country,
            p_degree: degree,
            p_expected_version: expectedVersion,
            p_request_id: requestId,
          },
        );
    if (response.error) {
      return applicationFailureState(
        form,
        applicationErrorStatus(response.error),
        null,
        requestId,
      );
    }
    const data = response.data;
    const applicationId = isRecord(data)
      ? applicationUuid(String(data.university_application_id ?? ""))
      : null;
    if (
      !isRecord(data) || !applicationId ||
      applicationUuid(String(data.organization_id ?? "")) !== actor.organizationId ||
      applicationUuid(String(data.student_case_id ?? "")) !== studentCaseId ||
      (catalogInstitutionId !== null &&
        applicationUuid(String(data.catalog_institution_id ?? "")) !==
          catalogInstitutionId) ||
      (catalogInstitutionId === null &&
        data.institution_name !== institutionName) ||
      data.program_name !== programName ||
      data.status !== status ||
      data.evidence_reference !== evidence || data.note !== note ||
      data.is_primary !== isPrimary ||
      data.university_deadline_on !== universityDeadlineOn ||
      data.country !== country || data.degree !== degree ||
      data.request_id !== requestId || data.expected_version !== "0" ||
      typeof data.version !== "string" ||
      applicationVersion(data.version, false) !== "1" ||
      !validApplicationChangedAt(data.changed_at) ||
      !validApplicationSwitchMetadata(data, applicationId, isPrimary)
    ) {
      return applicationFailureState(form, "unavailable", null, requestId);
    }
    revalidateApplication(studentCaseId);
    return Object.freeze({
      status: "saved" as const,
      requestId: randomUUID(),
      universityApplicationId: applicationId,
      version: "1",
    });
  } catch {
    return applicationFailureState(form, "unavailable", null, requestId);
  }
}

export async function updatePlatformUniversityApplicationDetailsAction(
  _previous: PlatformUniversityApplicationActionState,
  form: FormData,
): Promise<PlatformUniversityApplicationActionState> {
  const actor = await requirePlatformStaffActor();
  if (isStaffPreview(actor) || !staffHasPermission(actor, "application.manage")) {
    return applicationFailureState(form, "forbidden");
  }
  const fields = exactApplicationFields(form, UPDATE_APPLICATION_DETAILS_FIELDS);
  if (!fields) return applicationFailureState(form, "invalid");

  const applicationId = applicationUuid(applicationField(fields, "application_id"));
  const requestId = applicationUuid(applicationField(fields, "request_id"));
  const expectedVersion = applicationVersion(
    applicationField(fields, "expected_version"),
    false,
  );
  const isPrimary = parsePlatformApplicationPrimaryCheckbox(
    rawApplicationField(fields, "is_primary"),
  );
  const universityDeadlineOn = parsePlatformApplicationDeadlineInput(
    rawApplicationField(fields, "university_deadline_on"),
  );
  const submittedCountry = rawApplicationField(fields, "country");
  const submittedDegree = rawApplicationField(fields, "degree");
  if (
    !applicationId || !requestId || !expectedVersion ||
    isPrimary === null || universityDeadlineOn === undefined ||
    (submittedCountry !== "" &&
      !isPlatformApplicationCountryCode(submittedCountry)) ||
    (submittedDegree !== "" &&
      !isPlatformApplicationDegreeValue(submittedDegree))
  ) {
    return applicationFailureState(form, "invalid", applicationId, requestId);
  }

  try {
    const currentApplication = await getPlatformApplication(actor, applicationId);
    if (currentApplication === null) {
      return applicationFailureState(
        form,
        "unavailable",
        applicationId,
        requestId,
      );
    }
    const country = parsePlatformApplicationCountryDetailsInput(
      submittedCountry,
      currentApplication.country,
    );
    const degree = parsePlatformApplicationDegreeDetailsInput(
      submittedDegree,
      currentApplication.degree,
    );
    if (country === undefined || degree === undefined) {
      return applicationFailureState(form, "invalid", applicationId, requestId);
    }
    const client = await createSupabaseServerClient();
    const response = await client.schema("platform").rpc(
      "update_university_application_details",
      {
        p_organization_id: actor.organizationId,
        p_university_application_id: applicationId,
        p_is_primary: isPrimary,
        p_university_deadline_on: universityDeadlineOn,
        p_country: country,
        p_degree: degree,
        p_expected_version: expectedVersion,
        p_request_id: requestId,
      },
    );
    if (response.error) {
      return applicationFailureState(
        form,
        applicationErrorStatus(response.error),
        applicationId,
        requestId,
      );
    }
    const receipt = parsePlatformApplicationDetailsReceipt(response.data, {
      organizationId: actor.organizationId,
      universityApplicationId: applicationId,
      isPrimary,
      universityDeadlineOn,
      country,
      degree,
      requestId,
      expectedVersion,
    });
    if (!receipt) {
      return applicationFailureState(
        form,
        "unavailable",
        applicationId,
        requestId,
      );
    }
    revalidateApplication(receipt.studentCaseId);
    return Object.freeze({
      status: "saved" as const,
      requestId: randomUUID(),
      universityApplicationId: applicationId,
      version: receipt.version,
    });
  } catch {
    return applicationFailureState(
      form,
      "unavailable",
      applicationId,
      requestId,
    );
  }
}

export async function changePlatformUniversityApplicationAction(
  _previous: PlatformUniversityApplicationActionState,
  form: FormData,
): Promise<PlatformUniversityApplicationActionState> {
  const actor = await requirePlatformStaffActor();
  if (isStaffPreview(actor) || !staffHasPermission(actor, "application.manage")) {
    return applicationFailureState(form, "forbidden");
  }
  const fields = exactActionStringFields(form, CHANGE_APPLICATION_FIELDS);
  if (!fields) return applicationFailureState(form, "invalid");

  const applicationId = applicationUuid(applicationField(fields, "application_id"));
  const studentCaseId = applicationUuid(applicationField(fields, "student_case_id"));
  const requestId = applicationUuid(applicationField(fields, "request_id"));
  const expectedVersion = applicationVersion(
    applicationField(fields, "expected_version"),
    false,
  );
  const status = applicationStatus(applicationField(fields, "status"));
  const evidence = optionalApplicationText(
    applicationField(fields, "evidence_reference"),
    1_000,
  );
  const note = optionalApplicationText(applicationField(fields, "note"), 1_000);
  if (
    !applicationId || !studentCaseId || !requestId || !expectedVersion ||
    !status || evidence === undefined || note === undefined ||
    (PLATFORM_APPLICATION_EVIDENCE_STATUSES.has(status) && !evidence) ||
    ((status === "rejected" || status === "withdrawn") && !note)
  ) {
    return applicationFailureState(form, "invalid", applicationId, requestId);
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
        p_expected_version: expectedVersion,
        p_request_id: requestId,
      },
    );
    if (response.error) {
      return applicationFailureState(
        form,
        applicationErrorStatus(response.error),
        applicationId,
        requestId,
      );
    }
    const data = response.data;
    const nextVersion = isRecord(data) && typeof data.version === "string"
      ? applicationVersion(data.version, false)
      : null;
    if (
      !isRecord(data) ||
      applicationUuid(String(data.organization_id ?? "")) !== actor.organizationId ||
      applicationUuid(String(data.university_application_id ?? "")) !==
        applicationId ||
      applicationUuid(String(data.student_case_id ?? "")) !== studentCaseId ||
      data.status !== status || data.request_id !== requestId ||
      data.expected_version !== expectedVersion || !nextVersion ||
      BigInt(nextVersion) !== BigInt(expectedVersion) + BigInt(1)
    ) {
      return applicationFailureState(
        form,
        "unavailable",
        applicationId,
        requestId,
      );
    }
    revalidateApplication(studentCaseId);
    return Object.freeze({
      status: "saved" as const,
      requestId: randomUUID(),
      universityApplicationId: applicationId,
      version: nextVersion,
    });
  } catch {
    return applicationFailureState(
      form,
      "unavailable",
      applicationId,
      requestId,
    );
  }
}

/**
 * «Партнёр и решение» (unified workflow S7, plan §8/§11): editable since this
 * slice — `platform.update_application_partner_details_v1` (migration 184)
 * needs no admissions_playbook_version_id, unlike the retired 137 write
 * path. Gated identically to the kept create/details CRUD above
 * (application.manage), same request-id/expected-version conventions.
 */
export async function updateApplicationPartnerDetailsAction(
  _previous: PlatformUniversityApplicationActionState,
  form: FormData,
): Promise<PlatformUniversityApplicationActionState> {
  const actor = await requirePlatformStaffActor();
  if (isStaffPreview(actor) || !staffHasPermission(actor, "application.manage")) {
    return applicationFailureState(form, "forbidden");
  }
  const fields = exactActionStringFields(form, PARTNER_DETAILS_FIELDS);
  if (!fields) return applicationFailureState(form, "invalid");

  const applicationId = applicationUuid(applicationField(fields, "application_id"));
  const studentCaseId = applicationUuid(applicationField(fields, "student_case_id"));
  const requestId = applicationUuid(applicationField(fields, "request_id"));
  const expectedVersion = applicationVersion(
    applicationField(fields, "expected_version"),
    false,
  );
  const partnerContact = applicationText(applicationField(fields, "partner_contact"), 0, 300);
  const externalLink = applicationText(applicationField(fields, "external_link"), 0, 2_000);
  const decisionReference = applicationText(applicationField(fields, "decision_reference"), 0, 300);
  const decisionNote = applicationText(applicationField(fields, "decision_note"), 0, 2_000);
  if (
    !applicationId || !studentCaseId || !requestId || !expectedVersion ||
    partnerContact === null || externalLink === null ||
    decisionReference === null || decisionNote === null ||
    (externalLink !== "" && !HTTPS_LINK_PATTERN.test(externalLink))
  ) {
    return applicationFailureState(form, "invalid", applicationId, requestId);
  }

  try {
    const client = await createSupabaseServerClient();
    const response = await client.schema("platform").rpc(
      "update_application_partner_details_v1",
      {
        p_organization_id: actor.organizationId,
        p_request_id: requestId,
        p_student_case_id: studentCaseId,
        p_university_application_id: applicationId,
        p_expected_version: expectedVersion,
        p_fields: {
          partner_contact: partnerContact,
          external_link: externalLink,
          decision_reference: decisionReference,
          decision_note: decisionNote,
        },
      },
    );
    if (response.error) {
      return applicationFailureState(
        form,
        applicationErrorStatus(response.error),
        applicationId,
        requestId,
      );
    }
    const data = response.data;
    if (
      !isRecord(data) ||
      applicationUuid(String(data.university_application_id ?? "")) !== applicationId ||
      typeof data.version !== "string"
    ) {
      return applicationFailureState(form, "unavailable", applicationId, requestId);
    }
    revalidateApplication(studentCaseId);
    return Object.freeze({
      status: "saved" as const,
      requestId: randomUUID(),
      universityApplicationId: applicationId,
      version: data.version,
    });
  } catch {
    return applicationFailureState(form, "unavailable", applicationId, requestId);
  }
}
