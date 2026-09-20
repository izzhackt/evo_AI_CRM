import "server-only";

import { isStaffPreview } from "../platform-access.ts";
import { requirePlatformStaffActor } from "../platform-guards";
import { universityUuid } from "../platform-university-catalog.ts";
import { requireStudentPortalActor } from "../student-portal-guards";
import { createSupabaseServerClient } from "../supabase/server";
import { parseCatalogPreparations, type CatalogPreparation } from "./catalog-preparations.ts";

async function readPreparations(
  studentCaseId: string,
  rpc: "student_catalog_preparations_v1" | "staff_case_catalog_preparations_v1",
): Promise<readonly CatalogPreparation[]> {
  if (!universityUuid(studentCaseId) || studentCaseId !== studentCaseId.toLowerCase()) {
    throw new Error("Program preparations unavailable");
  }
  const client = await createSupabaseServerClient();
  const { data, error } = await client.schema("platform").rpc(rpc, { p_student_case_id: studentCaseId });
  const items = !error && parseCatalogPreparations(data, studentCaseId);
  if (!items) throw new Error("Program preparations unavailable");
  return items;
}

/** The RPC checks current ownership; case IDs never select a different actor. */
export async function readStudentCatalogPreparations(studentCaseId: string) {
  await requireStudentPortalActor();
  return readPreparations(studentCaseId, "student_catalog_preparations_v1");
}

/** Finance availability is deliberately not a prerequisite for this read. */
export async function readStaffCaseCatalogPreparations(studentCaseId: string) {
  const actor = await requirePlatformStaffActor();
  if (isStaffPreview(actor)) throw new Error("Program preparations unavailable");
  return readPreparations(studentCaseId, "staff_case_catalog_preparations_v1");
}
