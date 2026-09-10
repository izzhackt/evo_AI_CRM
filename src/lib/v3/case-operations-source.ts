import "server-only";
import type { ActivePlatformActor } from "../platform-auth";
import type { ActiveStudentPortalActor } from "../student-portal-auth";
import { createSupabaseServerClient } from "../supabase/server";
import { caseOperationUuid, decodeCaseHelpPage, decodePacketWorkspace, type HelpCursor } from "../platform-admissions-support-contract";

export async function caseOperationsRpc(name: string, args: Record<string, unknown>) {
  const client = await createSupabaseServerClient();
  const { data, error } = await client.schema("platform").rpc(name, args);
  if (error) throw error;
  return data as unknown;
}
export async function readPartnerPackets(actor: ActivePlatformActor, caseId: string) {
  if (actor.presentationRole === "sales" || !caseOperationUuid(caseId)) throw new Error("case_operations_forbidden");
  return decodePacketWorkspace(await caseOperationsRpc("partner_packet_workspace_v1", { p_case_id: caseId }), caseId);
}
export async function readCaseHelp(actor: ActivePlatformActor | ActiveStudentPortalActor, caseId: string, cursor: HelpCursor | null = null) {
  if (!caseOperationUuid(caseId) || ("presentationRole" in actor ? actor.presentationRole === "sales" : actor.studentCaseId !== caseId)) throw new Error("case_operations_forbidden");
  return decodeCaseHelpPage(await caseOperationsRpc("case_help_workspace_v1", {
    p_case_id: caseId, p_before_at: cursor?.at ?? null, p_before_id: cursor?.id ?? null,
  }), caseId);
}
