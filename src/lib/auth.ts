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
  type DevelopmentSession,
} from "./development-gate-core";
import type { Role } from "./roles";

const TECHNICAL_PROFILES = {
  admin: {
    id: -101,
    email: "admin@development.invalid",
    name: "Director/Admin",
  },
  sales: {
    id: -102,
    email: "sales@development.invalid",
    name: "Sales Manager",
  },
  admissions: {
    id: -103,
    email: "admissions@development.invalid",
    name: "Admissions Manager",
  },
} as const satisfies Record<
  DevelopmentGateRole,
  Readonly<{ id: number; email: string; name: string }>
>;

export type SessionUser = Readonly<{
  id: number;
  email: string;
  name: string;
  role: DevelopmentGateRole;
  authorityRole: DevelopmentGateRole;
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

export async function setSession(
  authorityRole: DevelopmentGateRole,
  effectiveRole: DevelopmentGateRole = authorityRole,
): Promise<void> {
  const config = readDevelopmentGateConfig();
  const token = createDevelopmentSessionToken(config, authorityRole, {
    effectiveRole,
  });
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

export async function currentDevelopmentSession(): Promise<DevelopmentSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(DEVELOPMENT_SESSION_COOKIE)?.value;
  if (!token) return null;

  try {
    return verifyDevelopmentSessionToken(readDevelopmentGateConfig(), token);
  } catch {
    return null;
  }
}

export async function currentUser(): Promise<SessionUser | null> {
  const session = await currentDevelopmentSession();
  if (!session) return null;
  return {
    ...TECHNICAL_PROFILES[session.effectiveRole],
    role: session.effectiveRole,
    authorityRole: session.role,
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
  if (user.role !== "admin") {
    return {
      response: NextResponse.json(
        { error: "forbidden" },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      ),
    };
  }
  return { user };
}
