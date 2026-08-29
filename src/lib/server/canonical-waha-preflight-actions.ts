"use server";

import { requirePlatformMessagingActor } from "@/lib/platform-guards";

import { exactActionStringFields } from "./action-form-fields";
import { runCanonicalWahaPreflight } from "./canonical-waha-preflight";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type CanonicalWahaPreflightActionState = Readonly<{
  status: "idle" | "invalid" | "blocked" | "working" | "not-working";
  reason: string | null;
  checkedAt: string | null;
  sessionName: string | null;
}>;

function invalid(
  reason: "invalid_request_id",
): CanonicalWahaPreflightActionState {
  return Object.freeze({
    status: "invalid",
    reason,
    checkedAt: null,
    sessionName: null,
  });
}

export async function runCanonicalWahaPreflightAction(
  _previous: CanonicalWahaPreflightActionState,
  form: FormData,
): Promise<CanonicalWahaPreflightActionState> {
  await requirePlatformMessagingActor();

  const fields = exactActionStringFields(form, ["preflight_request_id"]);
  const requestId = fields?.get("preflight_request_id");
  if (typeof requestId !== "string" || !UUID_PATTERN.test(requestId)) {
    return invalid("invalid_request_id");
  }

  const result = await runCanonicalWahaPreflight();
  if (result.status === "blocked") {
    return Object.freeze({
      status: "blocked",
      reason: result.reason,
      checkedAt: null,
      sessionName: null,
    });
  }

  if (result.status === "working") {
    return Object.freeze({
      status: "working",
      reason: null,
      checkedAt: result.checkedAt,
      sessionName: result.sessionName,
    });
  }

  return Object.freeze({
    status: "not-working",
    reason: result.reason,
    checkedAt: result.checkedAt,
    sessionName: result.sessionName,
  });
}
