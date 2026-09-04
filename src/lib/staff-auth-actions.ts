"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { canAdminSelectEffectiveRole } from "./fixed-role-policy";
import {
  ADMIN_ROLE_PREVIEW_COOKIE,
  resolvePlatformActor,
} from "./platform-auth";
import { createSupabaseServerClient } from "./supabase/server";
import { readVerifiedPlatformAuthority } from "./supabase/platform-authority";

export type StaffLoginActionState =
  | "accessDenied"
  | "authUnavailable"
  | "staffAccessDenied"
  | null;

function submittedValue(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

function logStaffAuthFailure(
  stage: "credentials" | "claims" | "authority",
  error: Readonly<{ code?: string; name?: string; status?: number }> | null,
): void {
  console.warn(
    JSON.stringify({
      event: "staff_auth_rejected",
      stage,
      code: error?.code ?? error?.name ?? "authority_rejected",
      status: error?.status ?? null,
      service: "evo-crm",
    }),
  );
}

async function clearAdminPreview(): Promise<void> {
  (await cookies()).delete(ADMIN_ROLE_PREVIEW_COOKIE);
}

export async function loginStaffAction(
  _previousState: StaffLoginActionState,
  form: FormData,
): Promise<StaffLoginActionState> {
  const email = submittedValue(form, "email").trim();
  const password = submittedValue(form, "password");
  if (
    email.length === 0 ||
    email.length > 320 ||
    password.length === 0 ||
    password.length > 4096
  ) {
    return "accessDenied";
  }

  let client;
  try {
    client = await createSupabaseServerClient();
    const { error: signInError } = await client.auth.signInWithPassword({
      email,
      password,
    });
    if (signInError) {
      logStaffAuthFailure("credentials", signInError);
      return "accessDenied";
    }

    const { data: claimsData, error: claimsError } = await client.auth.getClaims();
    if (claimsError || !claimsData?.claims) {
      logStaffAuthFailure("claims", claimsError);
      await client.auth.signOut({ scope: "local" });
      return "accessDenied";
    }

    const authority = await readVerifiedPlatformAuthority(
      client,
      claimsData.claims,
    );
    if (authority.status !== "authenticated") {
      logStaffAuthFailure("authority", null);
      await client.auth.signOut({ scope: "local" });
      return authority.status === "unavailable"
        ? "authUnavailable"
        : "staffAccessDenied";
    }
    await clearAdminPreview();
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "staff_auth_unavailable",
        code: error instanceof Error ? error.name : "unknown_error",
        service: "evo-crm",
      }),
    );
    return "authUnavailable";
  }
  redirect("/");
}

export async function logoutStaffAction(): Promise<void> {
  try {
    const client = await createSupabaseServerClient();
    await client.auth.signOut({ scope: "local" });
  } finally {
    await clearAdminPreview();
  }
  redirect("/login");
}

export async function selectStaffRolePreviewAction(
  form: FormData,
): Promise<void> {
  const result = await resolvePlatformActor();
  if (result.status !== "authenticated") redirect("/login");

  const requestedRole = form.get("role");
  if (!canAdminSelectEffectiveRole(result.actor.authorityRole, requestedRole)) {
    redirect("/access-denied?from=%2Fv3%2Fsettings");
  }

  (await cookies()).set(ADMIN_ROLE_PREVIEW_COOKIE, requestedRole, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60,
  });
  redirect("/");
}
