import type { SupabaseClient } from "@supabase/supabase-js";

import {
  readVerifiedStudentPortalAuthority,
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
}>;

async function defaultClient(): Promise<SupabaseClient> {
  const { createSupabaseServerClient } = await import("./supabase/server.ts");
  return createSupabaseServerClient();
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

  const authority = await readVerifiedStudentPortalAuthority(
    client,
    claimsData.claims,
  );
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
