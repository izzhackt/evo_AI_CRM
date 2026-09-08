import "server-only";

import type { PlatformActor } from "../platform-auth";
import { parseCoverageUuid, parseCoverageWorkspace, type CoverageWorkspace } from "../platform-case-coverage-contract";
import { createSupabaseServerClient } from "../supabase/server";

export async function readCuratorCoverageWorkspace(
  actor: PlatformActor,
  selection: Readonly<{ curatorId?: string; caseId?: string; afterCaseId?: string }>,
): Promise<CoverageWorkspace> {
  const unavailable = () => new Error("Curator coverage is unavailable.");
  if (actor.authorityRole !== "admin") throw unavailable();
  const organizationId = parseCoverageUuid(actor.organizationId);
  const curatorId = selection.curatorId === undefined ? null : parseCoverageUuid(selection.curatorId);
  const caseId = selection.caseId === undefined ? null : parseCoverageUuid(selection.caseId);
  const afterCaseId = selection.afterCaseId === undefined ? null : parseCoverageUuid(selection.afterCaseId);
  if (!organizationId || (selection.curatorId !== undefined && !curatorId)
    || (selection.caseId !== undefined && !caseId) || (selection.afterCaseId !== undefined && !afterCaseId)
    || ((caseId || afterCaseId) && !curatorId)) throw unavailable();
  // Cookie-bound RPC; no service key, demo row, injected repository or fallback.
  // https://supabase.com/docs/reference/javascript/rpc
  const client = await createSupabaseServerClient();
  const { data, error } = await client.schema("platform").rpc("read_curator_coverage_workspace", {
    p_organization_id: organizationId, p_curator_membership_id: curatorId,
    p_student_case_id: caseId, p_after_case_id: afterCaseId,
  });
  if (error) throw unavailable();
  const workspace = parseCoverageWorkspace(data, organizationId);
  if ((curatorId && !workspace.curators.some((curator) => curator.id === curatorId))
    || (caseId && workspace.preview?.id !== caseId)
    || (!caseId && workspace.preview !== null)) throw unavailable();
  return workspace;
}
