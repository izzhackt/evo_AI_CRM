"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { requirePlatformStaffActor } from "../platform-guards";
import { LOOK_PREVIEW_COOKIE, LOOK_PREVIEW_VALUE, lookPreviewAllowed } from "./look-preview-contract";

const PLATFORM_SETTINGS = "/v3/settings?section=platform";

/**
 * «Настройки → Платформа»: включить или выключить предпросмотр нового облика
 * (Э1.1). Только Admin вне просмотра роли; остальным действие ничего не
 * меняет. Cookie — настройка вида этого браузера, данные не пишутся.
 */
export async function setLookPreviewAction(form: FormData): Promise<void> {
  const actor = await requirePlatformStaffActor();
  if (!lookPreviewAllowed(actor)) redirect("/access-denied?from=%2Fv3%2Fsettings");
  const jar = await cookies();
  if (form.get("look") === LOOK_PREVIEW_VALUE) {
    jar.set(LOOK_PREVIEW_COOKIE, LOOK_PREVIEW_VALUE, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  } else {
    jar.delete(LOOK_PREVIEW_COOKIE);
  }
  revalidatePath("/v3", "layout");
  redirect(PLATFORM_SETTINGS);
}
