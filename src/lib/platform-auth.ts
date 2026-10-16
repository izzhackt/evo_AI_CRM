import type { JwtPayload } from "@supabase/supabase-js";
import { cookies, headers } from "next/headers";
import { cache } from "react";

import {
  FIXED_ROLES,
  isFixedRole,
  type FixedRole,
} from "./fixed-role-policy.ts";
import { createSupabaseServerClient } from "./supabase/server.ts";
import {
  platformAuthorityFromSnapshot,
  readVerifiedPlatformAuthority,
  type VerifiedPlatformAuthority,
} from "./supabase/platform-authority.ts";
import { ACCESS_HANDOFF_HEADER, verifyAccessHandoff } from "./supabase/access-handoff.ts";

export const ACTIVE_PLATFORM_ROLES = FIXED_ROLES;
export const ADMIN_ROLE_PREVIEW_COOKIE = "evo_admin_role_preview";

export type PlatformActor = VerifiedPlatformAuthority;

export type ActivePlatformActor = PlatformActor &
  Readonly<{
    /** Admin-only presentation choice; never a server authorization source. */
    presentationRole: FixedRole | null;
  }>;

export type PlatformActorInvalidReason =
  | "supabase_session_invalid"
  | "staff_authority_invalid"
  | "staff_authority_unavailable";

export type PlatformActorResult =
  | Readonly<{ status: "anonymous"; actor: null }>
  | Readonly<{
      status: "invalid";
      actor: null;
      reason: PlatformActorInvalidReason;
    }>
  | Readonly<{ status: "authenticated"; actor: ActivePlatformActor }>;

async function adminPreviewRole(systemRole: PlatformActor["systemRole"]): Promise<FixedRole | null> {
  if (systemRole !== "admin") return null;
  const requestedRole = (await cookies()).get(ADMIN_ROLE_PREVIEW_COOKIE)?.value;
  return isFixedRole(requestedRole) && requestedRole !== "admin" ? requestedRole : null;
}

/**
 * The staff snapshot the proxy read live for this same request (план A,
 * access-handoff.ts), or null — then the live RPC runs as before.
 */
async function handedOffStaffSnapshot(claims: JwtPayload): Promise<Readonly<{ data: unknown }> | null> {
  try {
    const requestHeaders = await headers();
    const rows = await verifyAccessHandoff(
      requestHeaders.get(ACCESS_HANDOFF_HEADER),
      requestHeaders.get("x-request-id"),
      claims,
    );
    return rows && Object.hasOwn(rows, "staff") ? { data: rows.staff } : null;
  } catch {
    return null;
  }
}

async function resolvePlatformActorOnce(): Promise<PlatformActorResult> {
  let client;
  try {
    client = await createSupabaseServerClient();
  } catch {
    return {
      status: "invalid",
      actor: null,
      reason: "staff_authority_unavailable",
    };
  }

  const { data: claimsData, error: claimsError } = await client.auth.getClaims();
  if (claimsError) {
    const missingSession = claimsError.name === "AuthSessionMissingError";
    return missingSession
      ? { status: "anonymous", actor: null }
      : {
          status: "invalid",
          actor: null,
          reason: "supabase_session_invalid",
        };
  }
  if (!claimsData?.claims) return { status: "anonymous", actor: null };

  const handedOff = await handedOffStaffSnapshot(claimsData.claims);
  const authorityResult = handedOff
    ? platformAuthorityFromSnapshot(handedOff.data, claimsData.claims)
    : await readVerifiedPlatformAuthority(client, claimsData.claims);
  if (authorityResult.status !== "authenticated") {
    return {
      status: "invalid",
      actor: null,
      reason:
        authorityResult.status === "unavailable"
          ? "staff_authority_unavailable"
          : "staff_authority_invalid",
    };
  }

  const authority = authorityResult.authority;
  const presentationRole = await adminPreviewRole(authority.systemRole);
  return {
    status: "authenticated",
    actor: {
      ...authority,
      presentationRole,
    },
  };
}

/**
 * Live staff authority, memoized only within one React server render (layout
 * + page + nested components), like `requireStudentPortalActor`. React
 * discards the memo between requests; outside a render it calls through.
 */
export const resolvePlatformActor = cache(resolvePlatformActorOnce);
