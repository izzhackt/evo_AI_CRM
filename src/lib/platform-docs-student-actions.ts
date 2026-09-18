"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePlatformStaffActor } from "./platform-guards";
import { isStaffPreview } from "./platform-access";
import { parseSalesUuid } from "./platform-sales-register-contract";
import { exactActionStringFields } from "./server/action-form-fields";
import { canCreateDocsStudent, createDocsStudent, DocsStudentSourceError } from "./v3/docs-student-source";

export type DocsStudentActionState = Readonly<{
  status: "idle" | "invalid" | "denied" | "request_conflict" | "unavailable";
  requestId: string;
}>;

export async function createDocsStudentAction(previous: DocsStudentActionState, form: FormData): Promise<DocsStudentActionState> {
  const actor = await requirePlatformStaffActor();
  const fields = exactActionStringFields(form, ["request_id", "display_name", "curator_membership_id", "target_country"]);
  const requestId = fields && parseSalesUuid(fields.get("request_id"));
  const failed = (status: DocsStudentActionState["status"]): DocsStudentActionState => ({
    status, requestId: requestId ?? parseSalesUuid(previous.requestId) ?? randomUUID(),
  });
  if (isStaffPreview(actor) || !canCreateDocsStudent(actor)) return failed("denied");
  if (!fields || !requestId) return failed("invalid");
  const displayName = fields.get("display_name")!.trim();
  const curatorMembershipId = parseSalesUuid(fields.get("curator_membership_id"));
  const targetCountry = fields.get("target_country")!.trim() || null;
  if (!displayName || displayName.length > 200 || !curatorMembershipId || (targetCountry?.length ?? 0) > 100
    || [displayName, targetCountry ?? ""].some(value => /[\u0000-\u001f\u007f]/.test(value))) return failed("invalid");

  let caseId: string;
  try {
    const result = await createDocsStudent(actor, { requestId, displayName, curatorMembershipId, targetCountry });
    caseId = result.caseId;
  } catch (error) {
    return failed(error instanceof DocsStudentSourceError ? error.code : "unavailable");
  }
  revalidatePath("/v3/profile");
  // redirect throws its routing signal; keep it outside the mutation catch.
  redirect(`/v3/profile?case=${encodeURIComponent(caseId)}&tab=anketa&section=docs`);
}
