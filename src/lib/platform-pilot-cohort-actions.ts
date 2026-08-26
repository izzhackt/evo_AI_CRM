"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requirePlatformClientsActor } from "./platform-guards";
import {
  configurePlatformPilotCohort,
  parsePlatformPilotConfigurationForm,
  parsePlatformPilotMembershipForm,
  reconcilePlatformPilotMutation,
  setPlatformStudentCasePilotMembership,
} from "./platform-pilot-cohort";

type PlatformPilotMutationOutcome = "saved" | "invalid" | "unavailable";
type PlatformPilotMutationOperation = "configuration" | "include" | "exclude";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

function safeFormUuid(form: FormData, key: string): string | null {
  const values = form.getAll(key);
  if (values.length !== 1 || typeof values[0] !== "string") return null;
  const value = values[0].trim().toLowerCase();
  return UUID_PATTERN.test(value) && value !== NIL_UUID ? value : null;
}

function pilotRedirect(
  studentCaseId: string | null,
  outcome: PlatformPilotMutationOutcome,
  operation?: PlatformPilotMutationOperation,
  requestId?: string | null,
): never {
  const params = new URLSearchParams({ u10_result: outcome });
  if (outcome === "unavailable" && operation && requestId) {
    params.set("u10_retry_operation", operation);
    params.set("u10_retry_request_id", requestId);
    if (studentCaseId) params.set("u10_subject_id", studentCaseId);
  }
  const target = studentCaseId
    ? `/clients/${studentCaseId}?${params.toString()}#pilot-cohort`
    : `/clients?${params.toString()}`;
  redirect(target);
}

async function finishPilotMutation(studentCaseId: string): Promise<never> {
  try {
    revalidatePath(`/clients/${studentCaseId}`);
    revalidatePath("/clients");
    revalidatePath("/applications");
  } catch {
    // The immutable request receipt is already committed. Cache invalidation
    // must not convert a successful idempotent mutation into a reported error.
  }
  return pilotRedirect(studentCaseId, "saved");
}

export async function configurePlatformPilotCohortAction(
  form: FormData,
): Promise<void> {
  const actor = await requirePlatformClientsActor();
  const fallbackStudentCaseId = safeFormUuid(form, "student_case_id");
  const fallbackRequestId = safeFormUuid(form, "request_id");
  const input = parsePlatformPilotConfigurationForm(form);
  if (!input || actor.platformRole !== "admin") {
    pilotRedirect(fallbackStudentCaseId, "invalid");
  }

  try {
    const receipt = await reconcilePlatformPilotMutation(() =>
      configurePlatformPilotCohort(actor, input)
    );
    if (receipt === null) {
      pilotRedirect(
        input.studentCaseId,
        "unavailable",
        "configuration",
        input.requestId,
      );
    }
  } catch {
    pilotRedirect(
      input.studentCaseId,
      "unavailable",
      "configuration",
      fallbackRequestId ?? input.requestId,
    );
  }

  await finishPilotMutation(input.studentCaseId);
}

export async function setPlatformStudentCasePilotMembershipAction(
  form: FormData,
): Promise<void> {
  const actor = await requirePlatformClientsActor();
  const fallbackStudentCaseId = safeFormUuid(form, "student_case_id");
  const fallbackRequestId = safeFormUuid(form, "request_id");
  const input = parsePlatformPilotMembershipForm(form);
  if (!input || actor.platformRole !== "admin") {
    pilotRedirect(fallbackStudentCaseId, "invalid");
  }

  try {
    const receipt = await reconcilePlatformPilotMutation(() =>
      setPlatformStudentCasePilotMembership(actor, input)
    );
    if (receipt === null) {
      pilotRedirect(
        input.studentCaseId,
        "unavailable",
        input.action,
        input.requestId,
      );
    }
  } catch {
    pilotRedirect(
      input.studentCaseId,
      "unavailable",
      input.action,
      fallbackRequestId ?? input.requestId,
    );
  }

  await finishPilotMutation(input.studentCaseId);
}
