import "server-only";

import { exactActionStringFields } from "./action-form-fields.ts";

export type StudentPortalAccessOperation = "prepare" | "reissue" | "reconcile";

const EXPECTED_BY_OPERATION = Object.freeze({
  prepare: [
    "organization_id", "student_case_id", "email", "display_name",
    "case_shape", "legacy_curator_membership_id", "reason", "request_id",
    "operation",
  ],
  reissue: [
    "organization_id", "receipt_id", "receipt_version",
    "invite_generation", "reason", "operation",
  ],
  reconcile: [
    "organization_id", "student_case_id", "email", "display_name",
    "case_shape", "legacy_curator_membership_id", "request_id",
    "receipt_id", "receipt_version", "invite_generation", "attempt_id",
    "invite_kind", "reissue_request_id", "operation",
  ],
} as const);

export function decodeStudentPortalAccessOperation(form: FormData): Readonly<{
  operation: StudentPortalAccessOperation;
  commandForm: FormData;
}> | null {
  for (const operation of ["prepare", "reissue", "reconcile"] as const) {
    const fields = exactActionStringFields(form, EXPECTED_BY_OPERATION[operation]);
    if (fields?.get("operation") !== operation) continue;
    const commandForm = new FormData();
    for (const [key, value] of fields) {
      if (key !== "operation") commandForm.append(key, value);
    }
    return { operation, commandForm };
  }
  return null;
}
