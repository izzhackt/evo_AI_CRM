import Link from "next/link";

import { LangSwitcher } from "@/components/LangSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { btnCls } from "@/components/ui";
import { logoutDevelopmentGateAction } from "@/lib/development-gate-actions";
import { fixedRoleCan, isFixedRole } from "@/lib/fixed-role-policy";
import { getT } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n-data";
import { requirePlatformActor } from "@/lib/platform-guards";

const COPY: Record<
  Locale,
  { eyebrow: string; title: string; description: string; openInbox: string }
> = {
  ru: {
    eyebrow: "Доступ подтверждён",
    title: "Раздел ещё не подключён",
    description:
      "Ваша временная V2-сессия и тестовая роль проверены. Этот модуль ещё не заменён, поэтому старый runtime не запускался.",
    openInbox: "Открыть сообщения",
  },
  ky: {
    eyebrow: "Кирүү ырасталды",
    title: "Бөлүм азырынча туташкан эмес",
    description:
      "Убактылуу V2 сессияңыз жана тесттик ролуңуз текшерилди. Бул модуль али алмаштырыла элек, ошондуктан эски runtime иштетилген жок.",
    openInbox: "Билдирүүлөрдү ачуу",
  },
  en: {
    eyebrow: "Access verified",
    title: "This module is not connected yet",
    description:
      "Your temporary V2 session and test role were verified. This module has not been replaced yet, so its old runtime was not started.",
    openInbox: "Open messaging",
  },
};

export default async function PlatformPendingPage() {
  const actor = await requirePlatformActor();
  const { t, locale } = await getT();
  const copy = COPY[locale];
  const canOpenInbox =
    isFixedRole(actor.platformRole) &&
    fixedRoleCan(actor.platformRole, "messaging.read");

  return (
    <main className="relative grid min-h-dvh place-items-center bg-bg px-4 py-10">
      <div className="absolute left-5 top-5 flex items-center gap-2.5">
        <span className="grid h-[34px] w-[34px] place-items-center rounded-[9px] bg-accent text-[16px] font-bold text-on-accent">
          E
        </span>
        <span className="leading-tight">
          <span className="block text-[15px] font-bold text-fg">EVO</span>
          <span className="block text-[11px] text-fg-3">Admissions CRM</span>
        </span>
      </div>
      <div className="absolute right-5 top-5 flex items-center gap-2.5">
        <LangSwitcher current={locale} />
        <ThemeToggle label={t("toggleTheme")} />
      </div>

      <section
        className="page-in w-full max-w-[520px] rounded-[20px] border border-border bg-surface p-7 shadow-evo-lg"
        data-testid="platform-pending"
      >
        <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-accent">
          {copy.eyebrow}
        </div>
        <h1 className="mt-2 text-[22px] font-bold leading-tight text-fg">
          {copy.title}
        </h1>
        <p className="mt-2 text-[13px] leading-6 text-fg-3">
          {copy.description}
        </p>
        <dl className="mt-5 grid gap-2 rounded-ctl bg-surface-2 p-4 text-[13px]">
          <div className="flex items-center justify-between gap-4">
            <dt className="text-fg-3">{t("role")}</dt>
            <dd className="font-semibold text-fg">
              {t(`role.${actor.platformRole}`)}
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
          <form action={logoutDevelopmentGateAction}>
            <button type="submit" className={btnCls}>
              {t("logout")}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
