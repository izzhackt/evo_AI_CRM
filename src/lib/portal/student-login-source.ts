import "server-only";

import { normalizeStudentLogin } from "../student-login";
import { createSupabaseServerClient } from "../supabase/server";

/** Свой логин для входа (340 own_student_login_v1). Нет логина или сбой — null: строки в профиле просто нет. */
export async function readOwnStudentLogin(): Promise<string | null> {
  try {
    const client = await createSupabaseServerClient();
    const { data, error } = await client.schema("platform").rpc("own_student_login_v1");
    return !error && typeof data === "string" ? normalizeStudentLogin(data) : null;
  } catch {
    return null;
  }
}
