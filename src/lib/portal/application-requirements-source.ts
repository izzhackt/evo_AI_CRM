import "server-only";

import { isStaffPreview, staffHasPermission } from "../platform-access.ts";
import { requirePlatformStaffActor } from "../platform-guards";
import { requireStudentPortalActor } from "../student-portal-guards";
import { createSupabaseServerClient } from "../supabase/server";
import {
  parseApplicationRequirementsTarget,
} from "./application-requirements.ts";
import { parseApplicationRequirementsV2, type ApplicationRequirementsV2 } from "./application-requirements-v2.ts";

async function readRequirements(
  studentCaseId: string,
  applicationId: string,
  rpc: "student_application_requirements_v2" | "staff_application_requirements_v2",
): Promise<ApplicationRequirementsV2> {
  const target = parseApplicationRequirementsTarget({ studentCaseId, applicationId });
  if (!target) throw new Error("Application requirements unavailable");
  try {
    const client = await createSupabaseServerClient();
    const { data, error } = await client.schema("platform").rpc(rpc, {
      p_student_case_id: target.studentCaseId, p_application_id: target.applicationId,
    });
    const requirements = !error && parseApplicationRequirementsV2(data, target.studentCaseId, target.applicationId);
    if (!requirements) throw new Error("Application requirements unavailable");
    return requirements;
  } catch {
    // A missing/foreign resource and transport failure never become an empty ready list.
    throw new Error("Application requirements unavailable");
  }
}

/** The ordinary Student session and RPC independently enforce ownership/document authority. */
export async function readStudentApplicationRequirements(studentCaseId: string, applicationId: string) {
  await requireStudentPortalActor();
  return readRequirements(studentCaseId, applicationId, "student_application_requirements_v2");
}

/** Case visibility alone is insufficient to disclose this document projection. */
export async function readStaffApplicationRequirements(studentCaseId: string, applicationId: string) {
  const actor = await requirePlatformStaffActor();
  if (isStaffPreview(actor) || !staffHasPermission(actor, "document.read.full")) {
    throw new Error("Application requirements unavailable");
  }
  // Organization comes from current server/RPC authority, never from caller input.
  return readRequirements(studentCaseId, applicationId, "staff_application_requirements_v2");
}
