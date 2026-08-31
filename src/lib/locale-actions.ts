"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { LOCALES, type Locale } from "./i18n-data";

/**
 * The one locale Server Action for every surface. It is deliberately isolated
 * in its own "use server" module: a language switcher must not pull a whole
 * action module — and every other action it exports — into the route graph of
 * the surface that renders it.
 */
export async function setLocaleAction(form: FormData): Promise<void> {
  const locale = String(form.get("locale") ?? "").trim() as Locale;
  if (!(LOCALES as readonly string[]).includes(locale)) return;
  const store = await cookies();
  store.set("locale", locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  revalidatePath("/", "layout");
}
