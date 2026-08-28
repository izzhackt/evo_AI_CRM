import "server-only";

import {
  fixedRoleCan,
  type FixedRoleCapability,
} from "../fixed-role-policy.ts";
import {
  resolvePlatformActor,
  type ActivePlatformActor,
} from "../platform-auth.ts";

export type PrivateDocumentAuthorization =
  | Readonly<{ status: "authorized"; actor: ActivePlatformActor }>
  | Readonly<{ status: "anonymous" | "forbidden"; actor: null }>;

export async function authorizePrivateDocumentRequest(
  capability: Extract<
    FixedRoleCapability,
    "documents.read" | "documents.write"
  >,
): Promise<PrivateDocumentAuthorization> {
  const result = await resolvePlatformActor();
  if (result.status !== "authenticated") {
    return { status: "anonymous", actor: null };
  }
  if (!fixedRoleCan(result.actor.platformRole, capability)) {
    return { status: "forbidden", actor: null };
  }
  return { status: "authorized", actor: result.actor };
}
