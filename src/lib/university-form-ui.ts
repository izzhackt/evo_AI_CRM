import type { UniversityFormCommandReceipt } from "./university-form-registry.ts";

/** Presentation result only. A saved registry command is not a verified file. */
export type UniversityFormActionStatus =
  | "idle" | "saved" | "forbidden" | "invalid_request" | "stale_revision"
  | "request_conflict" | "source_changed" | "archived" | "not_inspected"
  | "not_ready" | "unavailable";

export interface UniversityFormActionState {
  readonly status: UniversityFormActionStatus;
  readonly requestId: string;
  readonly receipt: UniversityFormCommandReceipt | null;
}

export type UniversityFormAction = (
  previous: UniversityFormActionState, form: FormData,
) => Promise<UniversityFormActionState>;
