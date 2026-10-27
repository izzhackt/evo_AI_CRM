"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { resolvePlatformActor } from "./platform-auth";
import {
  canUseNextUi,
  NEXT_UI_COOKIE,
  NEXT_UI_COOKIE_MAX_AGE_SECONDS,
  NEXT_UI_COOKIE_VALUE,
  nextUiReturnPath,
} from "./ui-next-contract";

/**
 * Включает или выключает «Новый вид» (cookie) и возвращает на ту же страницу — она перерисовывается заново.
 * Только настоящий администратор вне просмотра роли; остальным — отказ, cookie не пишется. Живая проверка
 * по сессии, как у `selectStaffRolePreviewAction`; cookie только про вид, права она не меняет.
 */
export async function setNextUiAction(enabled: boolean, returnTo: string): Promise<void> {
  const result = await resolvePlatformActor();
  if (result.status !== "authenticated") redirect("/login");
  if (!canUseNextUi(result.actor)) redirect("/access-denied?from=%2Fv3%2Fui-kit");

  const store = await cookies();
  if (enabled === true) {
    store.set(NEXT_UI_COOKIE, NEXT_UI_COOKIE_VALUE, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: NEXT_UI_COOKIE_MAX_AGE_SECONDS,
    });
  } else {
    store.delete(NEXT_UI_COOKIE);
  }
  redirect(nextUiReturnPath(returnTo));
}
