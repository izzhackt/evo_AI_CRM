"use client";
import { clearApplicationPackagePending, listApplicationPackagePending, persistApplicationPackagePending, withApplicationPackageLock,
  type ApplicationPackageScope, type ApplicationPackagePendingIntent } from "@/lib/portal/application-packages-pending";
import { submitStudentApplicationPackageAction, submitStaffApplicationPackageAction, reviewApplicationPackageAction,
  recoverStudentApplicationPackageAction, recoverStaffApplicationPackageAction } from "@/lib/portal/application-packages-actions";
import { applicationDocumentCanonical } from "@/lib/portal/application-documents";
import { parseApplicationPackageRecovery, type ApplicationPackageRecovery } from "@/lib/portal/application-packages";
export type PackageAudience = "student" | "staff";
export async function packageCommand(scope: ApplicationPackageScope, audience: PackageAudience, intent: ApplicationPackagePendingIntent, checkOnly = false) {
  const operation = "packageId" in intent ? "review" : "submit";
  const target = "packageId" in intent ? intent.packageId : intent.requirementsRevisionId;
  // One scope lock also serializes old/new revisions across tabs. Persisted keys
  // retain their actual immutable revision/package target.
  const locked = await withApplicationPackageLock(scope, "submit", scope.applicationId, async () => {
    const pending = listApplicationPackagePending(scope);
    if (!pending.some(entry => entry.intent && applicationDocumentCanonical(entry.intent) === applicationDocumentCanonical(intent)) && pending.length)
      return { kind: "pending" as const };
    persistApplicationPackagePending(scope, operation, target, intent);
    let proof: ApplicationPackageRecovery;
    try {
    if (checkOnly) {
      const response = await (audience === "student" ? recoverStudentApplicationPackageAction : recoverStaffApplicationPackageAction)(scope, operation, intent);
      if (!response.ok) return { kind: "error" as const, reason: response.reason };
      proof = response.recovery;
    } else {
      const response = "packageId" in intent ? await reviewApplicationPackageAction(scope, intent)
        : await (audience === "student" ? submitStudentApplicationPackageAction : submitStaffApplicationPackageAction)(scope, intent);
      if (!response.ok) return { kind: "error" as const, reason: response.reason };
      proof = { protocolVersion: 1, operation, requestId: intent.requestId, studentCaseId: intent.studentCaseId,
        applicationId: intent.applicationId, status: "committed", receipt: response.receipt };
    }
    } catch { return { kind: "error" as const, reason: "unavailable" as const }; }
    const validated = parseApplicationPackageRecovery(proof, operation, intent);
    if (!validated) return { kind: "error" as const, reason: "unavailable" as const };
    proof = validated;
    let cleared = false;
    try { cleared = clearApplicationPackagePending(scope, operation, target, intent, proof); } catch { /* Confirmed outcome remains visible. */ }
    return { kind: proof.status, proof, cleared };
  });
  return locked.acquired ? locked.value : { kind: locked.reason };
}

export function packageCommandFailure(result: { kind: string; reason?: string }, strings: import("./strings").PackageStrings): string {
  if (result.kind === "storage_unavailable") return strings.storage;
  if (result.kind === "busy") return strings.busy;
  if (result.kind === "error") return `${result.reason === "forbidden" ? strings.forbidden : strings.unavailable} ${strings.pending}`;
  return strings.pending;
}
