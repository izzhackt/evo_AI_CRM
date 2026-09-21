import { parseCatalogPreparationIntent, type CatalogPreparationIntent } from "./catalog-preparations";
import { parseApplicationRequirementsIntent, type ApplicationRequirementsIntent } from "./application-requirements";

export type StudentPreparationScope = Readonly<{
  organizationId: string;
  membershipId: string;
  studentCaseId: string;
}>;

type PendingIntent = CatalogPreparationIntent | ApplicationRequirementsIntent;
function storageKey(scope: StudentPreparationScope, kind: "selection" | "requirements", target: string): string {
  return ["evo:student-preparation:v1", scope.organizationId, scope.membershipId, scope.studentCaseId, kind, target].join(":");
}
export function selectionTarget(intent: Pick<CatalogPreparationIntent, "institutionId" | "programId" | "intakeId">): string {
  // Publication revisions never change the identity of an existing choice.
  return [intent.institutionId, intent.programId, intent.intakeId].join(":");
}
export function readPendingSelection(scope: StudentPreparationScope, target: string): CatalogPreparationIntent | null {
  const raw = sessionStorage.getItem(storageKey(scope, "selection", target));
  if (raw === null) return null;
  const intent = parseCatalogPreparationIntent(JSON.parse(raw));
  if (!intent || intent.studentCaseId !== scope.studentCaseId || selectionTarget(intent) !== target) throw new Error("Pending choice unavailable");
  return intent;
}
export function readPendingRequirements(scope: StudentPreparationScope, applicationId: string): ApplicationRequirementsIntent | null {
  const raw = sessionStorage.getItem(storageKey(scope, "requirements", applicationId));
  if (raw === null) return null;
  const intent = parseApplicationRequirementsIntent(JSON.parse(raw));
  if (!intent || intent.studentCaseId !== scope.studentCaseId || intent.applicationId !== applicationId) throw new Error("Pending preparation unavailable");
  return intent;
}
export function persistPreparationIntent(scope: StudentPreparationScope, intent: PendingIntent): void {
  const selection = "institutionId" in intent;
  const parsed = selection ? parseCatalogPreparationIntent(intent) : parseApplicationRequirementsIntent(intent);
  if (!parsed || parsed.studentCaseId !== scope.studentCaseId) throw new Error("Invalid preparation intent");
  const key = storageKey(scope, selection ? "selection" : "requirements", selection ? selectionTarget(intent) : intent.applicationId);
  const encoded = JSON.stringify(parsed);
  sessionStorage.setItem(key, encoded);
  if (sessionStorage.getItem(key) !== encoded) throw new Error("Pending preparation was not saved");
}
export function clearPreparationIntent(scope: StudentPreparationScope, intent: PendingIntent): void {
  const selection = "institutionId" in intent;
  const key = storageKey(scope, selection ? "selection" : "requirements", selection ? selectionTarget(intent) : intent.applicationId);
  const raw = sessionStorage.getItem(key);
  // Do not remove a newer command from another component.
  if (raw !== null && JSON.parse(raw).requestId === intent.requestId) sessionStorage.removeItem(key);
}
