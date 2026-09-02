import { NextResponse } from "next/server";

import type { FixedRole } from "./fixed-role-policy";
import {
  resolvePlatformActor,
  type ActivePlatformActor,
} from "./platform-auth";
import type { Role } from "./roles";

export type SessionUser = Readonly<{
  id: string;
  authUserId: string;
  email: string;
  name: string;
  role: FixedRole;
  authorityRole: FixedRole;
}>;

function actorToSessionUser(actor: ActivePlatformActor): SessionUser {
  return {
    id: actor.profileId,
    authUserId: actor.authUserId,
    email: actor.email,
    name: actor.displayName,
    role: actor.presentationRole,
    authorityRole: actor.authorityRole,
  };
}

export async function currentUser(): Promise<SessionUser | null> {
  const result = await resolvePlatformActor();
  return result.status === "authenticated"
    ? actorToSessionUser(result.actor)
    : null;
}

export function isStaff(role: Role): boolean {
  return role !== "client";
}

export type AdminApiAuthorization =
  | { user: SessionUser; response?: never }
  | { user?: never; response: NextResponse };

export async function requireAdminApi(): Promise<AdminApiAuthorization> {
  const user = await currentUser();
  if (!user) {
    return {
      response: NextResponse.json(
        { error: "authentication_required" },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      ),
    };
  }
  if (user.authorityRole !== "admin") {
    return {
      response: NextResponse.json(
        { error: "forbidden" },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      ),
    };
  }
  return { user };
}
