import type { UniversityFormCommandReceipt, UniversityFormWorkspace } from "./university-form-registry.ts";

/** After the session RPC: archived history is readable, never writable.
 * SQL rejects archived reads without live manager authority because publication
 * is null. can_manage also includes !archived, so it is not a read permission.
 */
export function universityFormWorkspaceMatches(workspace: UniversityFormWorkspace, organizationId: string, catalogId: string): boolean {
  return (workspace.can_manage || workspace.template.archived)
    && workspace.template.organization_id === organizationId && workspace.template.catalog_institution_id === catalogId;
}

/** Presentation result only. A saved registry command is not a verified file. */
export type UniversityFormActionStatus =
  | "idle" | "saved" | "forbidden" | "invalid_request" | "stale_revision"
  | "request_conflict" | "source_changed" | "archived" | "not_inspected"
  | "not_ready" | "unavailable";

export interface UniversityFormActionState {
  readonly status: UniversityFormActionStatus;
  readonly requestId: string;
  readonly receipt: UniversityFormCommandReceipt | null;
}

export type UniversityFormAction = (
  previous: UniversityFormActionState, form: FormData,
) => Promise<UniversityFormActionState>;
