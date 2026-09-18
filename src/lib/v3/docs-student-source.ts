import "server-only";

import { staffHasPermission } from "../platform-access.ts";
import type { PlatformActor } from "../platform-auth";
import { createSupabaseServerClient } from "../supabase/server";

export type DocsStudentOptions = Readonly<{
  curators: readonly Readonly<{ membershipId: string; displayName: string }>[];
  defaultCuratorMembershipId: string | null;
}>;
export type DocsStudentInput = Readonly<{
  requestId: string;
  displayName: string;
  curatorMembershipId: string;
  targetCountry: string | null;
}>;
export type DocsStudentReceipt = Readonly<{
  requestId: string;
  caseId: string;
  curatorMembershipId: string;
}>;
export class DocsStudentSourceError extends Error {
  readonly code: "invalid" | "denied" | "request_conflict" | "unavailable";
  constructor(code: DocsStudentSourceError["code"] = "unavailable") {
    super("Docs student intake unavailable");
    this.code = code;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function uuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}
function text(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max
    && !/[\u0000-\u001f\u007f]/.test(value);
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DocsStudentSourceError();
  return value as Record<string, unknown>;
}

/** Visibility only; each RPC independently checks the current scoped authority. */
export function canCreateDocsStudent(actor: PlatformActor): boolean {
  return staffHasPermission(actor, "profile.manage") && staffHasPermission(actor, "case.read.full");
}
function requireStaff(actor: PlatformActor): void {
  if (!canCreateDocsStudent(actor)) throw new DocsStudentSourceError("denied");
}
async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await (await createSupabaseServerClient()).schema("platform").rpc(name, args);
  if (error) {
    throw new DocsStudentSourceError(error.code === "42501" ? "denied"
      : error.code === "22023" && error.message.includes("docs_student_request_id_conflict") ? "request_conflict"
        : error.code === "22023" ? "invalid" : "unavailable");
  }
  return data;
}

export async function readDocsStudentOptions(actor: PlatformActor): Promise<DocsStudentOptions> {
  requireStaff(actor);
  const data = record(await rpc("docs_student_intake_options", { p_organization_id: actor.organizationId }));
  if (data.organization_id !== actor.organizationId || !Array.isArray(data.curators) || data.curators.length > 1000) {
    throw new DocsStudentSourceError();
  }
  const curators = data.curators.map((value) => {
    const item = record(value);
    if (!uuid(item.membership_id) || !text(item.display_name, 200)) throw new DocsStudentSourceError();
    return { membershipId: item.membership_id, displayName: item.display_name };
  });
  const defaultCuratorMembershipId = data.default_curator_membership_id;
  if (new Set(curators.map((item) => item.membershipId)).size !== curators.length
    || (defaultCuratorMembershipId !== null && (!uuid(defaultCuratorMembershipId)
      || defaultCuratorMembershipId !== actor.membershipId
      || !curators.some((item) => item.membershipId === defaultCuratorMembershipId)))) {
    throw new DocsStudentSourceError();
  }
  return { curators, defaultCuratorMembershipId };
}

export async function createDocsStudent(actor: PlatformActor, input: DocsStudentInput): Promise<DocsStudentReceipt> {
  requireStaff(actor);
  if (!uuid(input.requestId) || !uuid(input.curatorMembershipId) || !text(input.displayName, 200)
    || (input.targetCountry !== null && input.targetCountry !== "" && !text(input.targetCountry, 100))) {
    throw new DocsStudentSourceError("invalid");
  }
  const data = record(await rpc("create_docs_student", {
    p_organization_id: actor.organizationId,
    p_request_id: input.requestId,
    p_display_name: input.displayName.trim(),
    p_curator_membership_id: input.curatorMembershipId,
    p_target_country: input.targetCountry?.trim() || null,
  }));
  if (data.organization_id !== actor.organizationId || data.request_id !== input.requestId
    || data.curator_membership_id !== input.curatorMembershipId || !uuid(data.student_case_id)) {
    throw new DocsStudentSourceError();
  }
  return { requestId: input.requestId, caseId: data.student_case_id, curatorMembershipId: input.curatorMembershipId };
}
