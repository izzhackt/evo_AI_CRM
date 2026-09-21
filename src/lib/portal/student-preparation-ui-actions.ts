"use server";

import { requireStudentPortalActor } from "@/lib/student-portal-guards";
import { selectStudentCatalogIntakeAction } from "./catalog-preparations-actions";
import { parseCatalogPreparationIntent, type CatalogPreparationFailure } from "./catalog-preparations";
import { readStudentCatalogPreparations } from "./catalog-preparations-source";
import { initializeStudentApplicationRequirementsAction } from "./application-requirements-actions";
import { parseApplicationRequirementsIntent, type ApplicationRequirementsActionResult } from "./application-requirements";
import type { ApplicationRequirementsV2 } from "./application-requirements-v2";
import type { ApplicationDocuments } from "./application-documents";
import { readStudentApplicationDocuments } from "./application-documents-source";
import type { StudentPreparationScope } from "./student-preparation-pending";

async function scopedActor(scope: StudentPreparationScope) {
  const actor = await requireStudentPortalActor();
  return scope && actor.organizationId === scope.organizationId && actor.membershipId === scope.membershipId
    && actor.studentCaseId === scope.studentCaseId ? actor : null;
}

export async function selectStudentPreparationUIAction(scope: StudentPreparationScope, value: unknown): Promise<
  { ok: true; applicationId: string } | { ok: false; reason: CatalogPreparationFailure }
> {
  const actor = await scopedActor(scope);
  const intent = parseCatalogPreparationIntent(value);
  if (!actor || !intent || intent.studentCaseId !== actor.studentCaseId) return { ok: false, reason: "forbidden" };
  try {
    // Read before a retry: a lost response may already have created this binding.
    const current = await readStudentCatalogPreparations(actor.studentCaseId);
    const saved = current.find((item) => item.institutionId === intent.institutionId
      && item.programId === intent.programId && item.intakeId === intent.intakeId);
    if (saved) return { ok: true, applicationId: saved.applicationId };
    const result = await selectStudentCatalogIntakeAction(intent);
    return result.ok ? { ok: true, applicationId: result.receipt.applicationId } : result;
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export async function readStudentPreparationUIAction(scope: StudentPreparationScope, applicationId: string): Promise<
  { ok: true; requirements: ApplicationRequirementsV2; documents: ApplicationDocuments; canInitialize: boolean } | { ok: false }
> {
  const actor = await scopedActor(scope);
  if (!actor) return { ok: false };
  try {
    const items = await readStudentCatalogPreparations(actor.studentCaseId);
    const saved = items.find((item) => item.applicationId === applicationId);
    if (!saved) return { ok: false };
    const documents = await readStudentApplicationDocuments(actor.studentCaseId, applicationId);
    return { ok: true, requirements: documents.requirements, documents, canInitialize: actor.caseState === "active" && Boolean(actor.portalActivatedAt)
      && saved.applicationStatus === "preparation" };
  } catch {
    return { ok: false };
  }
}

export async function initializeStudentPreparationUIAction(scope: StudentPreparationScope, value: unknown): Promise<ApplicationRequirementsActionResult> {
  const actor = await scopedActor(scope);
  const intent = parseApplicationRequirementsIntent(value);
  if (!actor || !intent || intent.studentCaseId !== actor.studentCaseId) return { ok: false, reason: "forbidden", intent };
  return initializeStudentApplicationRequirementsAction(intent);
}
