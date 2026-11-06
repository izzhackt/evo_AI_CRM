import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { createRecoveryRateLimiter } from "../student-password-recovery-rate-limit.ts";
import type { StudentPasswordChangeStatus } from "../student-password-change-contract.ts";
import { getSupabasePublicConfig } from "../supabase/config.ts";
import { createSupabaseServerClient } from "../supabase/server.ts";

/**
 * Смена пароля студентом в кабинете. Текущий пароль проверяется настоящим входом на отдельном клиенте без сохранения
 * сессии (как восстановление: `isolatedClient`), новый пароль ставится в этой свежей сессии, она закрывается только у себя
 * (`scope: "local"`, сессия браузера остаётся), затем сессия кабинета открывается заново уже с новым паролем. Пароли не
 * пишутся в журнал и не возвращаются; счётчик попыток в памяти процесса, по id студента (production — один контейнер).
 */
const limiter = createRecoveryRateLimiter();
const RULE = { limit: 5, windowMs: 15 * 60 * 1000 } as const;

function isolatedClient(): SupabaseClient {
  const config = getSupabasePublicConfig();
  return createClient(config.url, config.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function errorFields(error: unknown): Readonly<{ code: string | null; status: number | null }> {
  const value = error as { code?: unknown; status?: unknown } | null;
  return {
    code: typeof value?.code === "string" ? value.code : null,
    status: typeof value?.status === "number" ? value.status : null,
  };
}

export async function changeStudentPassword(input: Readonly<{
  authUserId: string;
  email: string;
  currentPassword: string;
  newPassword: string;
}>): Promise<Exclude<StudentPasswordChangeStatus, "idle" | "mismatch" | "too_short" | "too_long">> {
  if (!limiter.consume(`password-change:${input.authUserId}`, RULE)) return "rate_limited";
  const client = isolatedClient();
  try {
    const signIn = await client.auth.signInWithPassword({ email: input.email, password: input.currentPassword });
    if (signIn.error || !signIn.data.session) {
      const { code, status } = errorFields(signIn.error);
      if (status === 429 || code === "over_request_rate_limit") return "rate_limited";
      if (code === "invalid_credentials" || status === 400) return "wrong_current";
      return "unavailable";
    }
    if (signIn.data.user?.id !== input.authUserId) {
      await client.auth.signOut({ scope: "local" }).catch(() => undefined);
      return "unavailable";
    }
    const update = await client.auth.updateUser({ password: input.newPassword });
    await client.auth.signOut({ scope: "local" }).catch(() => undefined);
    if (update.error) {
      const { code, status } = errorFields(update.error);
      if (code === "same_password") return "same_password";
      if (code === "weak_password") return "rejected";
      if (status === 429) return "rate_limited";
      return status !== null && status >= 400 && status < 500 ? "rejected" : "unavailable";
    }
  } catch {
    return "unavailable";
  }

  // Сессия кабинета заново, уже с новым паролем: студент остаётся в кабинете.
  try {
    const product = await createSupabaseServerClient();
    const again = await product.auth.signInWithPassword({ email: input.email, password: input.newPassword });
    if (again.error || !again.data.session || again.data.user?.id !== input.authUserId) return "sign_in_required";
  } catch {
    return "sign_in_required";
  }
  return "done";
}
