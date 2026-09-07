import "server-only";

import { fixedRoleCan, type FixedRole } from "../fixed-role-policy.ts";
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
  role: FixedRole,
): readonly PlatformReplySnippetAudience[] {
  return ROLE_AUDIENCES[role];
}

export function v3CanMutateReplySnippet(
  actor: ActivePlatformActor,
  snippet: Pick<PlatformReplySnippet, "createdByMembershipId">,
): boolean {
  return (
    actor.presentationRole === "admin" ||
    snippet.createdByMembershipId === actor.membershipId
  );
}

export async function readV3ReplySnippets(
  actor: ActivePlatformActor,
  reader: V3ReplySnippetReader = getPlatformReplySnippets,
): Promise<readonly PlatformReplySnippet[]> {
  if (!fixedRoleCan(actor.presentationRole, "messaging.read")) return [];

  const allowed = new Set(v3ReplySnippetAudiencesForRole(actor.presentationRole));
  const snippets = await reader(actor, null);
  return snippets.filter((snippet) => allowed.has(snippet.audience));
}
