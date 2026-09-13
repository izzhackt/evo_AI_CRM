import { isStaffPreview, staffCan, staffHasPermission } from "../platform-access.ts";
import "server-only";

import { type FixedRole } from "../fixed-role-policy.ts";
import type { ActivePlatformActor } from "../platform-auth.ts";
import {
  getPlatformReplySnippets,
  type PlatformReplySnippet,
  type PlatformReplySnippetAudience,
} from "../platform-reply-snippets.ts";

const ROLE_AUDIENCES = {
  admin: ["sales", "admissions", "all"],
  sales: ["sales", "all"],
  admissions: ["admissions", "all"],
} as const satisfies Record<FixedRole, readonly PlatformReplySnippetAudience[]>;

export type V3ReplySnippetReader = (
  actor: ActivePlatformActor,
  audience: PlatformReplySnippetAudience | null,
) => Promise<readonly PlatformReplySnippet[]>;

export function v3ReplySnippetAudiencesForRole(
  role: FixedRole | null,
): readonly PlatformReplySnippetAudience[] {
  return role === null ? ROLE_AUDIENCES.admin : ROLE_AUDIENCES[role];
}

export function v3ReplySnippetAudiences(actor: ActivePlatformActor): readonly PlatformReplySnippetAudience[] {
  const candidates = isStaffPreview(actor) ? v3ReplySnippetAudiencesForRole(actor.presentationRole) : ROLE_AUDIENCES.admin;
  return candidates.filter(audience => staffHasPermission(actor, `reply.snippet.${audience}`));
}

export function v3CanMutateReplySnippet(
  actor: ActivePlatformActor,
  snippet: Pick<PlatformReplySnippet, "createdByMembershipId">,
): boolean {
  return (
    !isStaffPreview(actor) && staffHasPermission(actor,
      snippet.createdByMembershipId === actor.membershipId ? "reply.snippet.manage" : "reply.snippet.moderate")
  );
}

export async function readV3ReplySnippets(
  actor: ActivePlatformActor,
  reader: V3ReplySnippetReader = getPlatformReplySnippets,
): Promise<readonly PlatformReplySnippet[]> {
  if (!staffCan(actor, "snippets.read")) return [];

  const snippets = await reader(actor, null);
  if (!isStaffPreview(actor) || actor.presentationRole === null) return snippets;
  const allowed = new Set(v3ReplySnippetAudiences(actor));
  return snippets.filter((snippet) => allowed.has(snippet.audience));
}
