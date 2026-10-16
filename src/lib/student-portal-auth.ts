import type { JwtPayload, SupabaseClient } from "@supabase/supabase-js";

import {
  isStudentAuthorityRow,
  readStudentPortalAuthorityRows,
  readVerifiedStudentPortalAuthority,
  studentPortalAuthorityFromRows,
  type StudentPortalAuthorityResult,
  type VerifiedStudentPortalAuthority,
} from "./supabase/student-portal-authority.ts";

export type ActiveStudentPortalActor = VerifiedStudentPortalAuthority;

export type StudentPortalActorInvalidReason =
  | "supabase_session_invalid"
  | "student_authority_invalid"
  | "student_authority_unavailable";

export type StudentPortalActorResult =
  | Readonly<{ status: "anonymous"; actor: null }>
  | Readonly<{
      status: "invalid";
      actor: null;
      reason: StudentPortalActorInvalidReason;
    }>
  | Readonly<{ status: "authenticated"; actor: ActiveStudentPortalActor }>;

export type StudentPortalAuthDependencies = Readonly<{
  createClient?: () => Promise<SupabaseClient>;
  /**
   * The rows the proxy read live for this same request (access-handoff.ts).
   * Default: the request header in production; an injected client without
   * this dependency (tests) always reads live.
   */
  handedOffRows?: (claims: JwtPayload) => Promise<Readonly<{ actor?: unknown; cases?: unknown }> | null>;
}>;

export type StudentPortalBearerAuthDependencies = Readonly<{
  createClient?: (accessToken: string) => Promise<SupabaseClient>;
}>;

async function defaultClient(): Promise<SupabaseClient> {
  const { createSupabaseServerClient } = await import("./supabase/server.ts");
  return createSupabaseServerClient();
}

async function defaultHandedOffRows(
  claims: JwtPayload,
): Promise<Readonly<{ actor?: unknown; cases?: unknown }> | null> {
  try {
    const [{ headers }, { ACCESS_HANDOFF_HEADER, verifyAccessHandoff }] = await Promise.all([
      import("next/headers"),
      import("./supabase/access-handoff.ts"),
    ]);
    const requestHeaders = await headers();
    return await verifyAccessHandoff(
      requestHeaders.get(ACCESS_HANDOFF_HEADER),
      requestHeaders.get("x-request-id"),
      claims,
    );
  } catch {
    return null;
  }
}

/** A Student answer from handed-off rows, or null when they are incomplete. */
function handedOffStudentAuthority(
  claims: JwtPayload,
  rows: Readonly<{ actor?: unknown; cases?: unknown }> | null,
): StudentPortalAuthorityResult | null {
  if (!rows || !Object.hasOwn(rows, "actor")) return null;
  // A Student row without its projection was not fully read: read it live.
  if (isStudentAuthorityRow(rows.actor) && !Object.hasOwn(rows, "cases")) return null;
  return studentPortalAuthorityFromRows(claims, rows.actor, rows.cases);
}

async function defaultBearerClient(
  accessToken: string,
): Promise<SupabaseClient> {
  const { createSupabaseBearerServerClient } = await import(
    "./supabase/server.ts"
  );
  return createSupabaseBearerServerClient(accessToken);
}

/** Resolve only active Student Portal authority; staff remains a separate path. */
export async function resolveStudentPortalActor(
  dependencies: StudentPortalAuthDependencies = {},
): Promise<StudentPortalActorResult> {
  let client: SupabaseClient;
  try {
    client = dependencies.createClient
      ? await dependencies.createClient()
      : await defaultClient();
  } catch {
    return {
      status: "invalid",
      actor: null,
      reason: "student_authority_unavailable",
    };
  }

  const { data: claimsData, error: claimsError } = await client.auth.getClaims();
  if (claimsError) {
    return claimsError.name === "AuthSessionMissingError"
      ? { status: "anonymous", actor: null }
      : {
          status: "invalid",
          actor: null,
          reason: "supabase_session_invalid",
        };
  }
  if (!claimsData?.claims) return { status: "anonymous", actor: null };

  const handedOffRows = dependencies.handedOffRows
    ?? (dependencies.createClient ? null : defaultHandedOffRows);
  const handedOff = handedOffRows
    ? handedOffStudentAuthority(claimsData.claims, await handedOffRows(claimsData.claims))
    : null;
  // Live fallback (Server Actions, POST APIs, no handoff): both reads start
  // together and are interpreted in the same order as the sequential reader.
  const authority = handedOff
    ?? (await readStudentPortalAuthorityRows(client, claimsData.claims, { parallel: true })).result;
  if (authority.status !== "authenticated") {
    return {
      status: "invalid",
      actor: null,
      reason:
        authority.status === "unavailable"
          ? "student_authority_unavailable"
          : "student_authority_invalid",
    };
  }

  return { status: "authenticated", actor: authority.authority };
}

/**
 * PORT-8a (ADR 0030 «Решение» п. 2): resolve the same active Student Portal
 * authority from an explicit Supabase access token instead of the cookie
 * session. Supabase Auth verifies the token (`getClaims(<jwt>)` checks
 * signature and expiry; there is no hand-rolled JWT verification here), then
 * the exact cookie-path chain (`readVerifiedStudentPortalAuthority`) runs on
 * a client whose PostgREST calls carry that same token. A present token never
 * resolves to "anonymous": the caller must not consult cookies for it.
 */
export async function resolveStudentPortalBearerActor(
  accessToken: string,
  dependencies: StudentPortalBearerAuthDependencies = {},
): Promise<StudentPortalActorResult> {
  let client: SupabaseClient;
  try {
    client = dependencies.createClient
      ? await dependencies.createClient(accessToken)
      : await defaultBearerClient(accessToken);
  } catch {
    return {
      status: "invalid",
      actor: null,
      reason: "student_authority_unavailable",
    };
  }

  let claims: JwtPayload;
  try {
    const { data: claimsData, error: claimsError } =
      await client.auth.getClaims(accessToken);
    if (claimsError || !claimsData?.claims) {
      return {
        status: "invalid",
        actor: null,
        reason: "supabase_session_invalid",
      };
    }
    claims = claimsData.claims;
  } catch {
    // A malformed token can throw before Supabase classifies it as an
    // AuthError. It stays a rejected bearer credential, never "anonymous".
    return {
      status: "invalid",
      actor: null,
      reason: "supabase_session_invalid",
    };
  }

  const authority = await readVerifiedStudentPortalAuthority(client, claims);
  if (authority.status !== "authenticated") {
    return {
      status: "invalid",
      actor: null,
      reason:
        authority.status === "unavailable"
          ? "student_authority_unavailable"
          : "student_authority_invalid",
    };
  }

  return { status: "authenticated", actor: authority.authority };
}
