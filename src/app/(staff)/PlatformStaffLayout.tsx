import Link from "next/link";

import { Icon } from "@/components/icons";
import { MobileStaffNav, StaffNav, type MobileNavCopy, type NavGroup } from "@/components/StaffNav";
import { TopBar } from "@/components/TopBar";
import { EvoWordmark } from "@/components/platform/EvoWordmark";
import { PlatformLangSwitcher } from "@/components/platform/PlatformLangSwitcher";
import { getT } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n-data";
import { logoutPlatformAction } from "@/lib/platform-admissions-actions";
import { platformHomeRoute, requirePlatformStaffActor } from "@/lib/platform-guards";

const SHELL_COPY: Record<Locale, MobileNavCopy & { skip: string }> = {
  ru: {
    skip: "Перейти к основному содержимому",
    navigationLabel: "Основная навигация",
    moreLabel: "Ещё",
    menuTitle: "Все разделы",
    closeLabel: "Закрыть меню",
  },
  ky: {
    skip: "Негизги мазмунга өтүү",
    navigationLabel: "Негизги навигация",
    moreLabel: "Дагы",
    menuTitle: "Бардык бөлүмдөр",
    closeLabel: "Менюну жабуу",
  },
  en: {
    skip: "Skip to main content",
    navigationLabel: "Primary navigation",
    moreLabel: "More",
    menuTitle: "All sections",
    closeLabel: "Close menu",
  },
};

function initials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase() ?? "")
      .join("") || "EV"
  );
}

export default async function PlatformStaffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [actor, { t, locale }] = await Promise.all([
    requirePlatformStaffActor(),
    getT(),
  ]);
  if (actor.platformRole === "student") {
    throw new Error("Student actor cannot render the staff layout.");
  }
  const homeHref = platformHomeRoute(actor.platformRole);
  const operations = [
    ...(actor.platformRole === "admin" || actor.platformRole === "sales"
      ? [{ href: "/sales", label: t("sales") }]
      : []),
    ...(actor.platformRole !== "finance"
      ? [
          { href: "/clients", label: t("clients") },
          { href: "/applications", label: t("applications") },
        ]
      : []),
  ];
  const communications =
    actor.platformRole === "finance"
      ? []
      : [{ href: "/whatsapp", label: t("whatsapp") }];
  const groups: NavGroup[] = [
    ...(operations.length > 0
      ? [{ label: t("navOperations"), items: operations }]
      : []),
    ...(communications.length > 0
      ? [{ label: t("navCommunications"), items: communications }]
      : []),
  ];
  const shellCopy = SHELL_COPY[locale];
  const titles = {
    "/dashboard": { title: "EVO Platform" },
    "/sales": { title: t("admissionsPipeline"), hint: "amoCRM · OP" },
    "/clients": { title: t("student360"), hint: "OZO" },
    "/applications": { title: t("applicationQueue"), hint: "OZO" },
    "/whatsapp": { title: `${t("whatsapp")} · ${t("inbox")}` },
  };
  const account = (
    <div className="mobile-menu-account">
      <span className="staff-account__avatar">{initials(actor.displayName)}</span>
      <div className="staff-account__copy">
        <div>{actor.displayName}</div>
        <span>{t(`role.${actor.role}`)}</span>
      </div>
      <form action={logoutPlatformAction}>
        <button type="submit" className="mobile-menu-account__logout">
          <Icon name="log-out" size={18} />
          <span>{t("logout")}</span>
        </button>
      </form>
    </div>
  );

  return (
    <>
      <a href="#staff-main" className="skip-link">
        {shellCopy.skip}
      </a>
      <div className="staff-shell">
        <aside className="staff-sidebar">
          <Link href={homeHref} aria-label={t("appName")} className="staff-brand">
            <EvoWordmark inverted />
          </Link>
          <StaffNav groups={groups} label={shellCopy.navigationLabel} />
          <div className="staff-account">
            <span className="staff-account__avatar">
              {initials(actor.displayName)}
            </span>
            <div className="staff-account__copy">
              <div>{actor.displayName}</div>
              <span>{t(`role.${actor.role}`)}</span>
            </div>
            <form action={logoutPlatformAction}>
              <button
                type="submit"
                aria-label={t("logout")}
                title={t("logout")}
                className="staff-account__logout"
              >
                <Icon name="log-out" size={18} />
              </button>
            </form>
          </div>
        </aside>

        <div className="staff-workspace">
          <TopBar
            titles={titles}
            locale={locale}
            role={actor.platformRole}
            homeHref={homeHref}
            addLabel={t("add")}
            themeLabel={t("toggleTheme")}
            notificationCount={0}
            notificationCountCapped={false}
            notificationPreview={[]}
            integrationStatus={{
              amo: "blocked",
              whatsapp: "blocked",
            }}
            connectedRoutesOnly
            languageSwitcher={<PlatformLangSwitcher current={locale} />}
          />
          <main
            id="staff-main"
            tabIndex={-1}
            className="staff-main mx-auto w-full max-w-[1360px] px-4 py-5 pb-28 sm:px-6 md:px-6 md:py-7 md:pb-8"
          >
            <div className="page-in">{children}</div>
          </main>
        </div>

        <MobileStaffNav groups={groups} copy={shellCopy} footer={account} />
      </div>
    </>
  );
}
