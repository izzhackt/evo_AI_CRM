import type { Metadata } from "next";
import Link from "next/link";

import { LangSwitcher } from "@/components/LangSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { btnCls } from "@/components/ui";
import { logoutStaffAction } from "@/lib/staff-auth-actions";
import { fixedRoleCan, isFixedRole } from "@/lib/fixed-role-policy";
import { getT } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n-data";
import { requirePlatformActor } from "@/lib/platform-guards";
import { buildRouteMetadata } from "@/lib/route-metadata";

const COPY: Record<
  Locale,
  {
    title: string;
    tabTitle: string;
    description: string;
    openInbox: string;
  }
> = {
  ru: {
    title: "Раздел ещё не подключён",
    tabTitle: "Раздел не подключён",
    description:
      "Ваша Supabase-сессия и активная роль сотрудника проверены. Этот модуль ещё не заменён, поэтому старый runtime не запускался.",
    openInbox: "Открыть сообщения",
  },
  ky: {
    title: "Бөлүм азырынча туташкан эмес",
    tabTitle: "Бөлүм туташкан эмес",
    description:
      "Supabase кызматкер сессияңыз жана активдүү ролуңуз текшерилди. Бул модуль али алмаштырыла элек, ошондуктан эски runtime иштетилген жок.",
    openInbox: "Билдирүүлөрдү ачуу",
  },
  en: {
    title: "This module is not connected yet",
    tabTitle: "Module not connected",
    description:
      "Your Supabase staff session and active role were verified. This module has not been replaced yet, so its old runtime was not started.",
    openInbox: "Open messaging",
  },
};

export async function generateMetadata(): Promise<Metadata> {
  // Short noun phrase for the tab; the h1 keeps the full sentence.
  return buildRouteMetadata({
    ru: COPY.ru.tabTitle,
    ky: COPY.ky.tabTitle,
    en: COPY.en.tabTitle,
  });
}

export default async function PlatformPendingPage() {
  const actor = await requirePlatformActor();
  const { t, locale } = await getT();
  const copy = COPY[locale];
  const canOpenInbox =
    isFixedRole(actor.presentationRole) &&
    fixedRoleCan(actor.presentationRole, "messaging.read");

  return (
    <main className="relative grid min-h-dvh place-items-center bg-bg px-4 py-10">
      <div className="absolute left-5 top-5 flex items-center gap-2.5">
        <span className="grid h-[34px] w-[34px] place-items-center rounded-[9px] bg-accent text-lg font-bold text-on-accent">
          E
        </span>
        <span className="leading-tight">
          <span className="block text-md font-bold text-fg">EVO</span>
          <span className="block text-xs text-fg-3">Admissions CRM</span>
        </span>
      </div>
      <div className="absolute right-5 top-5 flex items-center gap-2.5">
        <LangSwitcher current={locale} />
        <ThemeToggle label={t("toggleTheme")} />
      </div>

      <section
        className="page-in w-full max-w-[520px] rounded-[20px] bg-surface p-7 shadow-evo-lg"
        data-testid="platform-pending"
      >
        <h1 className="mt-2 text-2xl font-bold leading-tight text-fg">
          {copy.title}
        </h1>
        <p className="mt-2 text-sm leading-6 text-fg-3">
          {copy.description}
        </p>
        <dl className="mt-5 grid gap-2 rounded-ctl bg-surface-2 p-4 text-sm">
          <div className="flex items-center justify-between gap-4">
            <dt className="text-fg-3">{t("role")}</dt>
            <dd
              className="font-semibold text-fg"
              data-testid="pending-role"
              data-role={actor.presentationRole}
              data-authority-role={actor.authorityRole}
            >
              {t(`role.${actor.presentationRole}`)}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-fg-3">{t("name")}</dt>
            <dd className="font-semibold text-fg">{actor.displayName}</dd>
          </div>
        </dl>
        <div className="mt-6 flex flex-wrap gap-3">
          {canOpenInbox && (
            <Link href="/whatsapp" className={btnCls}>
              {copy.openInbox}
            </Link>
          )}
          <form action={logoutStaffAction}>
            <button type="submit" className={btnCls}>
              {t("logout")}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
