/** A render token is freshness evidence, never a command request identity. */
export type CreateRecovery = Readonly<{
  baselineToken: string;
  refreshRequested: boolean;
}>;

type CalendarCreateRecoveryInput = Readonly<{
  recovery: CreateRecovery | null;
  renderToken: string;
  actionPending: boolean;
  refreshPending: boolean;
  navigationPending: boolean;
  allowed: boolean;
  caseId: string;
  candidateCaseId: string;
  candidateRenderToken: string;
  candidatesReady: boolean;
  eligibleAssignee: boolean;
}>;

export function canEditCalendarCreate(input: CalendarCreateRecoveryInput): boolean {
  return input.recovery !== null && input.recovery.refreshRequested &&
    input.recovery.baselineToken !== input.renderToken &&
    !input.actionPending && !input.refreshPending && !input.navigationPending &&
    input.allowed && input.caseId !== "" &&
    input.candidateCaseId === input.caseId &&
    input.candidateRenderToken === input.renderToken &&
    input.candidatesReady;
}

export function canResumeCalendarCreate(input: CalendarCreateRecoveryInput): boolean {
  return canEditCalendarCreate(input) && input.eligibleAssignee;
}

export function nextCalendarCreateAttempt(
  status: string, returnedRequestId: string, pending: boolean,
): string | null {
  return status === "saved" && !pending ? returnedRequestId : null;
}
