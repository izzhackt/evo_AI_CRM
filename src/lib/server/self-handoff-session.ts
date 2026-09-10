import "server-only";

import type { PlatformActor } from "../platform-auth.ts";
import { readVerifiedPlatformAuthority } from "../supabase/platform-authority.ts";
import { createSupabaseServerClient } from "../supabase/server.ts";

/**
 * Only for an already-confirmed Admin self-handoff. The existing SSR client's
 * cookie adapter propagates the renewed session from this Server Action.
 * Authorization still requires a signed JWT plus the live authority RPC.
 */
export async function refreshConfirmedSelfHandoffSession(
  actor: PlatformActor,
): Promise<boolean> {
  if (actor.authorityRole !== "admin") return false;

  try {
    const client = await createSupabaseServerClient();
    const { error: refreshError } = await client.auth.refreshSession();
    if (refreshError) return false;

    const { data, error: claimsError } = await client.auth.getClaims();
    if (claimsError || !data?.claims) return false;

    const result = await readVerifiedPlatformAuthority(client, data.claims);
    if (result.status !== "authenticated") return false;

    const { authority } = result;
    return (
      authority.authUserId === actor.authUserId &&
      authority.profileId === actor.profileId &&
      authority.membershipId === actor.membershipId &&
      authority.organizationId === actor.organizationId &&
      authority.databaseRole === "admin"
    );
  } catch {
    return false;
  }
}
