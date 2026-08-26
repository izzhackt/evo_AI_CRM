"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";

import { requirePlatformSalesActor } from "./platform-guards";
import {
  mutatePlatformAdmissionsHandoff,
  parsePlatformAdmissionsHandoffFormData,
  parsePlatformAdmissionsHandoffUuid,
  PlatformAdmissionsHandoffRepositoryError,
  type PlatformAdmissionsHandoffMode,
} from "./platform-admissions-handoff";

export type PlatformAdmissionsHandoffActionStatus =
  | "idle"
  | "saved"
  | "invalid"
  | "forbidden"
  | "stale"
  | "request_conflict"
  | "unavailable";

export type PlatformAdmissionsHandoffActionState = Readonly<{
  status: PlatformAdmissionsHandoffActionStatus;
  requestId: string;
  gateVersion: number | null;
  caseId: string | null;
  handoffMode: PlatformAdmissionsHandoffMode | null;
  changedAt: string | null;
}>;

function single(form: FormData, key: string): FormDataEntryValue | undefined {
  const values = form.getAll(key);
  return values.length === 1 ? values[0] : undefined;
}

function initialOrNewRequestId(form: FormData): string {
  return parsePlatformAdmissionsHandoffUuid(single(form, "request_id")) ?? randomUUID();
}

function failureState(
  form: FormData,
  status: Exclude<
    PlatformAdmissionsHandoffActionStatus,
    "idle" | "saved"
  > = "invalid",
): PlatformAdmissionsHandoffActionState {
  return Object.freeze({
    status,
    requestId:
      status === "request_conflict"
        ? randomUUID()
        : initialOrNewRequestId(form),
    gateVersion: null,
    caseId: null,
    handoffMode: null,
    changedAt: null,
  });
}

export async function updatePlatformAdmissionsHandoffAction(
  _previous: PlatformAdmissionsHandoffActionState,
  form: FormData,
): Promise<PlatformAdmissionsHandoffActionState> {
  const actor = await requirePlatformSalesActor();
  const input = parsePlatformAdmissionsHandoffFormData(form);
  if (input === null) return failureState(form);

  try {
    const receipt = await mutatePlatformAdmissionsHandoff(actor, input);
    revalidatePath("/sales");
    revalidatePath(`/sales/${input.leadId}`);
    if (receipt.caseId) {
      revalidatePath("/clients");
      revalidatePath(`/clients/${receipt.caseId}`);
      revalidatePath("/applications");
    }
    return Object.freeze({
      status: "saved",
      requestId: randomUUID(),
      gateVersion: receipt.gateVersion,
      caseId: receipt.caseId,
      handoffMode: receipt.handoffMode,
      changedAt: receipt.changedAt,
    });
  } catch (error) {
    if (error instanceof PlatformAdmissionsHandoffRepositoryError) {
      return failureState(form, error.kind);
    }
    return failureState(form, "unavailable");
  }
}
