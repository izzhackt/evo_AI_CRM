"use server";

import { redirect } from "next/navigation";

import {
  authenticateDevelopmentGate,
  clearSession,
  setSession,
} from "./auth";
import { DevelopmentGateConfigError } from "./development-gate-core";

export type DevelopmentGateActionState =
  | "accessDenied"
  | "gateUnavailable"
  | null;

function submittedValue(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

export async function loginDevelopmentGateAction(
  _previousState: DevelopmentGateActionState,
  form: FormData,
): Promise<DevelopmentGateActionState> {
  const identifier = submittedValue(form, "identifier");
  const secret = submittedValue(form, "secret");

  let role;
  try {
    role = authenticateDevelopmentGate(identifier, secret);
    if (!role) return "accessDenied";
    await setSession(role);
  } catch (error) {
    if (error instanceof DevelopmentGateConfigError) {
      console.error(JSON.stringify({
        event: "development_gate_unavailable",
        code: error.code,
        service: "evo-crm",
      }));
      return "gateUnavailable";
    }
    console.error(JSON.stringify({
      event: "development_gate_unavailable",
      code: "development_gate_internal_error",
      service: "evo-crm",
    }));
    return "gateUnavailable";
  }

  redirect("/");
}

export async function logoutDevelopmentGateAction(): Promise<void> {
  await clearSession();
  redirect("/login");
}
