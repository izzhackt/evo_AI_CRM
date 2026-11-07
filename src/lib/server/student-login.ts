import "server-only";

import { normalizeStudentLogin } from "../student-login.ts";
import { getPlatformSupabaseBackendConfig } from "./platform-supabase-backend-config";
import { createPlatformSupabaseServiceClient } from "./platform-supabase-service-client";

export type StudentLoginEmail =
  | Readonly<{ status: "found"; email: string }>
  | Readonly<{ status: "missing" | "unavailable" }>;

/** Почта для входа по логину студента (340). Только на сервере: в браузер почта не уходит. */
export async function resolveStudentLoginEmail(input: string): Promise<StudentLoginEmail> {
  const login = normalizeStudentLogin(input);
  if (!login) return { status: "missing" };
  try {
    const service = createPlatformSupabaseServiceClient(getPlatformSupabaseBackendConfig());
    const { data, error } = await service.schema("platform")
      .rpc("student_login_email_v1", { p_login: login })
      .abortSignal(AbortSignal.timeout(10000));
    if (error) return { status: "unavailable" };
    return typeof data === "string" && data.includes("@") ? { status: "found", email: data } : { status: "missing" };
  } catch {
    return { status: "unavailable" };
  }
}
