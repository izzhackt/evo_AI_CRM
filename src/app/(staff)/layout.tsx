import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser, isStaff } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { logoutAction } from "@/lib/actions";
import { MobileStaffNav, StaffNav, type MobileNavCopy, type NavGroup } from "@/components/StaffNav";
import { TopBar } from "@/components/TopBar";
import { Icon } from "@/components/icons";
import { EvoWordmark } from "@/components/platform/EvoWordmark";
import { STAFF_NAV_ITEMS } from "@/lib/domain";
import type { Locale } from "@/lib/i18n-data";

const NAV_GROUP_DEFS = [
  { key: "navOperations", hrefs: ["/dashboard", "/sales", "/clients", "/applications", "/documents"] },
  { key: "navCommunications", hrefs: ["/whatsapp", "/calls", "/chat"] },
  { key: "navAnalytics", hrefs: ["/tasks", "/reports", "/finance"] },
  { key: "navSystem", hrefs: ["/settings"] },
] as const;

const SHELL_COPY: Record<
  Locale,
  MobileNavCopy & {
    skip: string;
  }
> = {
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

function initials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "EV"
  );
}

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!isStaff(user.role)) redirect("/portal");
  const { t, locale } = await getT();
  const shellCopy = SHELL_COPY[locale];

  const allowed = new Map(
    STAFF_NAV_ITEMS
      .filter((item) => (item.allowedRoles as readonly string[]).includes(user.role))
      .map((item) => [item.href as string, t(item.labelKey)] as const),
  );
  const groups: NavGroup[] = NAV_GROUP_DEFS
    .map((g) => ({
      label: t(g.key),
      items: g.hrefs.filter((h) => allowed.has(h)).map((h) => ({ href: h, label: allowed.get(h)! })),
    }))
    .filter((g) => g.items.length > 0);

  const titles: Record<string, { title: string; hint?: string }> = {
    "/dashboard": { title: t("commandCenter"), hint: t("commandCenterHint") },
    "/sales": { title: t("admissionsPipeline"), hint: t("admissionsPipelineHint") },
    "/clients": { title: t("student360"), hint: t("student360Hint") },
    "/applications": { title: t("applicationQueue"), hint: t("applicationQueueHint") },
    "/documents": { title: t("documentQueue"), hint: t("documentQueueHint") },
    "/whatsapp": { title: `${t("whatsapp")} · ${t("inbox")}` },
    "/calls": { title: t("callLog") },
    "/chat": { title: t("chat"), hint: t("channels") },
    "/tasks": { title: t("taskBoard"), hint: t("taskBoardHint") },
    "/reports": { title: t("salesReport") },
    "/finance": { title: t("financeOverview"), hint: t("financeOverviewHint") },
    "/settings": { title: t("integrationSettings"), hint: t("adminOnly") },
  };

  return (
    <>
      <a href="#staff-main" className="skip-link">
        {shellCopy.skip}
      </a>
      <div className="staff-shell">
        <aside className="staff-sidebar">
          <Link href="/dashboard" aria-label={t("appName")} className="staff-brand">
            <EvoWordmark inverted />
          </Link>

          <StaffNav groups={groups} label={shellCopy.navigationLabel} />

          <div className="staff-account">
            <span className="staff-account__avatar">
              {initials(user.name)}
            </span>
            <div className="staff-account__copy">
              <div>{user.name}</div>
              <span>{t(`role.${user.role}`)}</span>
            </div>
            <form action={logoutAction}>
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
          <TopBar titles={titles} locale={locale} addLabel={t("add")} themeLabel={t("toggleTheme")} />
          <main
            id="staff-main"
            tabIndex={-1}
            className="staff-main mx-auto w-full max-w-[1360px] px-4 py-5 pb-28 sm:px-6 md:px-6 md:py-7 md:pb-8"
          >
            <div className="page-in">{children}</div>
          </main>
        </div>

        <MobileStaffNav
          groups={groups}
          copy={shellCopy}
          footer={
            <div className="mobile-menu-account">
              <span className="staff-account__avatar">{initials(user.name)}</span>
              <div className="staff-account__copy">
                <div>{user.name}</div>
                <span>{t(`role.${user.role}`)}</span>
              </div>
              <form action={logoutAction}>
                <button type="submit" className="mobile-menu-account__logout">
                  <Icon name="log-out" size={18} />
                  <span>{t("logout")}</span>
                </button>
              </form>
            </div>
          }
        />
      </div>
    </>
  );
}
