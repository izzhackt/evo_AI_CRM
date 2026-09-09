"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "./supabase/server";
import { resolvePlatformActor } from "./platform-auth";

export type StaffAccountState = Readonly<{ ready: boolean; email: string; error: string }>;

export async function acceptStaffAccountAction(_previous: StaffAccountState, form: FormData): Promise<StaffAccountState> {
  try {
    const client = await createSupabaseServerClient();
    const tokenHash = String(form.get("token_hash") ?? "");
    const type = form.get("type");
    const code = String(form.get("code") ?? "");
    const accessToken = String(form.get("access_token") ?? "");
    const refreshToken = String(form.get("refresh_token") ?? "");
    let error;
    // Only an explicit same-origin Server Action consumes the emailed token.
    // Support configured TokenHash templates, PKCE and provider implicit links.
    // https://supabase.com/docs/reference/javascript/auth-verifyotp
    // https://supabase.com/docs/reference/javascript/auth-exchangecodeforsession
    if (/^[0-9a-f]{56}$/.test(tokenHash) && (type === "invite" || type === "recovery") && !code && !accessToken) {
      ({ error } = await client.auth.verifyOtp({ token_hash: tokenHash, type }));
    } else if (code && code.length <= 2048 && !tokenHash && !accessToken) {
      ({ error } = await client.auth.exchangeCodeForSession(code));
    } else if (accessToken && accessToken.length <= 16384 && refreshToken && refreshToken.length <= 2048
      && (type === "invite" || type === "recovery") && !code && !tokenHash) {
      ({ error } = await client.auth.setSession({ access_token: accessToken, refresh_token: refreshToken }));
    } else {
      return { ready: false, email: "", error: "Ссылка неполная. Откройте исходное письмо для сотрудника EVO." };
    }
    if (error) return { ready: false, email: "", error: "Ссылка недействительна, уже использована или истекла. Обратитесь к администратору EVO." };
    const result = await resolvePlatformActor();
    if (result.status !== "authenticated" || !["admin", "sales", "admissions"].includes(result.actor.authorityRole)) {
      await client.auth.signOut({ scope: "local" });
      return { ready: false, email: "", error: "Вход подтверждён, но доступ сотрудника ещё не активен. Администратору нужно проверить приглашение в журнале." };
    }
    return { ready: true, email: result.actor.email, error: "" };
  } catch {
    return { ready: false, email: "", error: "Сервис входа недоступен. Обратитесь к администратору, не запрашивая повторное письмо." };
  }
}

export async function setStaffPasswordAction(_previous: StaffAccountState, form: FormData): Promise<StaffAccountState> {
  const result = await resolvePlatformActor();
  if (result.status !== "authenticated" || !["admin", "sales", "admissions"].includes(result.actor.authorityRole)) {
    return { ready: false, email: "", error: "Доступ сотрудника не подтверждён. Откройте письмо заново или обратитесь к администратору." };
  }
  const password = String(form.get("password") ?? "");
  if (password.length < 12 || password.length > 128 || password !== form.get("confirmation")) {
    return { ready: true, email: result.actor.email, error: "Пароли должны совпадать и содержать от 12 до 128 символов." };
  }
  try {
    const client = await createSupabaseServerClient();
    const { error } = await client.auth.updateUser({ password });
    if (error) return { ready: true, email: result.actor.email, error: "Пароль не сохранён. Проверьте требования сервиса входа или обратитесь к администратору." };
    // The normal login obtains a fresh server-verified role after provisioning.
    await client.auth.signOut({ scope: "local" });
  } catch {
    return { ready: true, email: result.actor.email, error: "Не удалось подтвердить сохранение пароля. Проверьте вход с выбранным паролем." };
  }
  redirect("/login");
}
