export const STUDENT_CASE_STATES = ["pending", "active", "closed"] as const;
export type StudentCaseState = (typeof STUDENT_CASE_STATES)[number];

export const STUDENT_CASE_AUDIT_EVENTS = [
  "assigned",
  "reassigned",
  "closed",
  "reopened",
] as const;
export type StudentCaseAuditEvent = (typeof STUDENT_CASE_AUDIT_EVENTS)[number];

export const STUDENT_CASE_REASON_MAX_LENGTH = 1_000;

type CaseActor = {
  id: number;
  role: string;
};

type AssignedCase = {
  curatorId: number | null;
};

type AssignmentCandidate = {
  caseState: StudentCaseState;
  contractConfirmedAt: string | null;
  contractConfirmationRef: string | null;
};

export function isStudentCaseState(value: string): value is StudentCaseState {
  return (STUDENT_CASE_STATES as readonly string[]).includes(value);
}

export function normalizeStudentCaseReason(value: unknown): string | null {
  const reason = String(value ?? "").trim();
  if (!reason || reason.length > STUDENT_CASE_REASON_MAX_LENGTH) return null;
  return reason;
}

export function canAssignCurator(role: string): boolean {
  return role === "admin";
}

export function canTransitionStudentCase(
  actor: CaseActor,
  studentCase: AssignedCase,
): boolean {
  return actor.role === "admin"
    || (actor.role === "curator" && studentCase.curatorId === actor.id);
}

export function nextCaseStateForAssignment(
  studentCase: AssignmentCandidate,
): StudentCaseState | null {
  if (
    !studentCase.contractConfirmedAt
    || !studentCase.contractConfirmationRef?.trim()
  ) {
    return null;
  }
  return studentCase.caseState === "pending" ? "active" : studentCase.caseState;
}

export function workflowOwnerForState(
  caseState: StudentCaseState,
): "sales" | "curator" {
  return caseState === "pending" ? "sales" : "curator";
}
