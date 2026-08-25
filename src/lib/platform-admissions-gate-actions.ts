"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";

import { requirePlatformSalesActor } from "./platform-guards";
import {
  mutatePlatformAdmissionsGate,
  parsePlatformAdmissionsGateFormData,
  parsePlatformAdmissionsGateUuid,
  PlatformAdmissionsGateRepositoryError,
  type PlatformAdmissionsGateState,
} from "./platform-admissions-gate";

export type PlatformAdmissionsGateActionStatus =
  | "idle"
  | "saved"
  | "invalid"
  | "forbidden"
  | "stale"
  | "request_conflict"
  | "unavailable";

export type PlatformAdmissionsGateActionState = Readonly<{
  status: PlatformAdmissionsGateActionStatus;
  requestId: string;
  gateVersion: number | null;
  gateState: PlatformAdmissionsGateState | null;
  changedAt: string | null;
}>;

function single(form: FormData, key: string): FormDataEntryValue | undefined {
  const values = form.getAll(key);
  return values.length === 1 ? values[0] : undefined;
}

function initialOrNewRequestId(form: FormData): string {
  return parsePlatformAdmissionsGateUuid(single(form, "request_id")) ?? randomUUID();
}

function failureState(
  form: FormData,
  status: Exclude<
    PlatformAdmissionsGateActionStatus,
    "idle" | "saved"
  > = "invalid",
): PlatformAdmissionsGateActionState {
  return Object.freeze({
    status,
    requestId:
      status === "request_conflict"
        ? randomUUID()
        : initialOrNewRequestId(form),
    gateVersion: null,
    gateState: null,
    changedAt: null,
  });
}

export async function updatePlatformAdmissionsGateAction(
  _previous: PlatformAdmissionsGateActionState,
  form: FormData,
): Promise<PlatformAdmissionsGateActionState> {
  const actor = await requirePlatformSalesActor();
  const input = parsePlatformAdmissionsGateFormData(form);
  if (input === null) return failureState(form);

  try {
    const receipt = await mutatePlatformAdmissionsGate(actor, input);
    revalidatePath("/sales");
    revalidatePath(`/sales/${input.leadId}`);
    return Object.freeze({
      status: "saved" as const,
      requestId: randomUUID(),
      gateVersion: receipt.gateVersion,
      gateState: receipt.gateState,
      changedAt: receipt.changedAt,
    });
  } catch (error) {
    if (error instanceof PlatformAdmissionsGateRepositoryError) {
      return failureState(form, error.kind);
    }
    return failureState(form, "unavailable");
  }
}
