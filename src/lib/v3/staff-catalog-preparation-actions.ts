"use server";

import { isStaffPreview, staffHasPermission } from "../platform-access";
import { requirePlatformStaffActor } from "../platform-guards";
import { parseUniversityFilters, universityUuid, type UniversityPage } from "../platform-university-catalog";
import { readStaffCaseCatalogPreparations } from "../portal/catalog-preparations-source";
import type { ApplicationRequirementsV2 } from "../portal/application-requirements-v2";
import { readStaffApplicationDocuments } from "../portal/application-documents-source";
import { parseApplicationRequirementsTarget } from "../portal/application-requirements";
import type { CatalogPreparation } from "../portal/catalog-preparations";
import { readStaffUniversities } from "./university-source";
import { selectStaffCatalogIntakeAction } from "../portal/catalog-preparations-actions";
import { initializeStaffApplicationRequirementsAction } from "../portal/application-requirements-actions";
import type { CatalogPreparationActionResult } from "../portal/catalog-preparations";
import type { ApplicationRequirementsActionResult } from "../portal/application-requirements";

export type StaffPreparationRead<T> = Readonly<{ status: "ready"; value: T }>
  | Readonly<{ status: "invalid" | "forbidden" | "unavailable" }>;

type RequestOwner = Readonly<{ organizationId: string; membershipId: string }>;
/** An account switch must never replay another account's retained request. */
export async function selectStaffPreparationAction(owner: RequestOwner, input: unknown): Promise<CatalogPreparationActionResult> {
  const actor = await requirePlatformStaffActor();
  if (!owner || owner.organizationId !== actor.organizationId || owner.membershipId !== actor.membershipId) return { ok: false, reason: "forbidden" };
  return selectStaffCatalogIntakeAction(input);
}
export async function initializeStaffPreparationAction(owner: RequestOwner, input: unknown): Promise<ApplicationRequirementsActionResult> {
  const actor = await requirePlatformStaffActor();
  if (!owner || owner.organizationId !== actor.organizationId || owner.membershipId !== actor.membershipId) return { ok: false, reason: "forbidden", intent: null };
  return initializeStaffApplicationRequirementsAction(input);
}

/** Published data only. The manual institution search keeps its existing contract. */
export async function searchStaffPreparationCatalogAction(input: unknown): Promise<StaffPreparationRead<UniversityPage>> {
  const actor = await requirePlatformStaffActor();
  if (isStaffPreview(actor) || !staffHasPermission(actor, "catalog.read")) return { status: "forbidden" };
  if (!input || typeof input !== "object" || Array.isArray(input)) return { status: "invalid" };
  const row = input as Record<string, unknown>;
  if (Object.keys(row).length !== 3 || Object.keys(row).some((key) => !["query", "offset", "institutionId"].includes(key))
    || typeof row.query !== "string" || typeof row.offset !== "number" || !Number.isSafeInteger(row.offset)
    || (row.institutionId !== null && !universityUuid(row.institutionId))) return { status: "invalid" };
  const filters = parseUniversityFilters({ q: row.query, offset: String(row.offset) });
  if (!filters) return { status: "invalid" };
  try {
    return { status: "ready", value: await readStaffUniversities(actor, filters, row.institutionId as string | null) };
  } catch {
    return { status: "unavailable" };
  }
}

export async function readStaffPreparationsAction(caseId: string): Promise<StaffPreparationRead<readonly CatalogPreparation[]>> {
  const actor = await requirePlatformStaffActor();
  if (isStaffPreview(actor) || !staffHasPermission(actor, "case.read.full")) return { status: "forbidden" };
  if (!universityUuid(caseId)) return { status: "invalid" };
  try {
    return { status: "ready", value: await readStaffCaseCatalogPreparations(caseId) };
  } catch {
    return { status: "unavailable" };
  }
}

export async function readStaffPreparationRequirementsAction(input: unknown): Promise<StaffPreparationRead<ApplicationRequirementsV2>> {
  const actor = await requirePlatformStaffActor();
  if (isStaffPreview(actor) || !staffHasPermission(actor, "document.read.full")) return { status: "forbidden" };
  const target = parseApplicationRequirementsTarget(input);
  if (!target) return { status: "invalid" };
  try {
    // Initialization only needs the definition state. New document UI consumes the
    // full program reader so legacy material reviews cannot become program acceptance.
    const documents = await readStaffApplicationDocuments(target.studentCaseId, target.applicationId);
    return { status: "ready", value: documents.requirements };
  } catch {
    return { status: "unavailable" };
  }
}
