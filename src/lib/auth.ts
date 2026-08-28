import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";

import {
  DEVELOPMENT_SESSION_COOKIE,
  authenticateDevelopmentProfile,
  createDevelopmentSessionToken,
  developmentSessionCookieOptions,
  readDevelopmentGateConfig,
  verifyDevelopmentSessionToken,
  type DevelopmentGateRole,
} from "./development-gate-core";
import type { Role } from "./roles";

const TECHNICAL_PROFILES = {
  admin: {
    id: -101,
    email: "admin@development.invalid",
    name: "Director/Admin",
    role: "admin",
  },
  sales: {
    id: -102,
    email: "sales@development.invalid",
    name: "Sales Manager",
    role: "sales",
  },
  admissions: {
    id: -103,
    email: "admissions@development.invalid",
    name: "Admissions Manager",
    // The accepted pre-#427 shell still names this UI role `curator`. Server
    // authorization must use developmentRole; #427 removes this UI projection.
    role: "curator",
  },
} as const satisfies Record<
  DevelopmentGateRole,
  Readonly<{ id: number; email: string; name: string; role: Role }>
>;

export type SessionUser = Readonly<{
  id: number;
  email: string;
  name: string;
  role: Role;
  developmentRole: DevelopmentGateRole;
}>;

function requestUsesHttps(requestHeaders: Headers): boolean {
  if (process.env.NODE_ENV === "production") return true;
  return requestHeaders
    .get("x-forwarded-proto")
    ?.split(",")
    .some((value) => value.trim().toLowerCase() === "https") ?? false;
}

export function authenticateDevelopmentGate(
  identifier: string,
  secret: string,
): DevelopmentGateRole | null {
  const config = readDevelopmentGateConfig();
  return authenticateDevelopmentProfile(config, identifier, secret);
}

export async function setSession(role: DevelopmentGateRole): Promise<void> {
  const config = readDevelopmentGateConfig();
  const token = createDevelopmentSessionToken(config, role);
  const [cookieStore, requestHeaders] = await Promise.all([cookies(), headers()]);
  cookieStore.set(
    DEVELOPMENT_SESSION_COOKIE,
    token,
    developmentSessionCookieOptions({ secure: requestUsesHttps(requestHeaders) }),
  );
}

export async function clearSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(DEVELOPMENT_SESSION_COOKIE);
}

export async function currentDevelopmentRole(): Promise<DevelopmentGateRole | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(DEVELOPMENT_SESSION_COOKIE)?.value;
  if (!token) return null;

  try {
    return verifyDevelopmentSessionToken(readDevelopmentGateConfig(), token)?.role ?? null;
  } catch {
    return null;
  }
}

export async function currentUser(): Promise<SessionUser | null> {
  const developmentRole = await currentDevelopmentRole();
  if (!developmentRole) return null;
  return {
    ...TECHNICAL_PROFILES[developmentRole],
    developmentRole,
  };
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
  if (user.developmentRole !== "admin") {
    return {
      response: NextResponse.json(
        { error: "forbidden" },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      ),
    };
  }
  return { user };
}
