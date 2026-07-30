import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { getIntegrationStatus, logoutAction } from "@/lib/actions";
import { MobileStaffNav, StaffNav, type MobileNavCopy, type NavGroup } from "@/components/StaffNav";
import { TopBar } from "@/components/TopBar";
import { Icon } from "@/components/icons";
import { EvoWordmark } from "@/components/platform/EvoWordmark";
import { STAFF_NAV_ITEMS, isStaffRole } from "@/lib/domain";
import type { Locale } from "@/lib/i18n-data";
import { requirePlatformStaffActor } from "@/lib/platform-guards";
import { isUiContractFixtureMode } from "@/lib/runtime-mode";
import {
  listOperatorNotificationsForActor,
  OPERATOR_NOTIFICATION_LIMIT,
  type OperatorNotification,
} from "@/lib/queries";

const NAV_GROUP_DEFS = [
  { key: "navOperations", hrefs: ["/dashboard", "/sales", "/clients", "/applications", "/documents", "/visa"] },
  { key: "navCommunications", hrefs: ["/whatsapp", "/calls", "/chat", "/notifications"] },
  { key: "navAnalytics", hrefs: ["/tasks", "/reports", "/finance"] },
  { key: "navSystem", hrefs: ["/settings"] },
] as const;

const SHELL_COPY: Record<
  Locale,
  MobileNavCopy & {
    skip: string;
    accessDeniedTitle: string;
    accessDeniedHint: string;
  }
> = {
  ru: {
    skip: "Перейти к основному содержимому",
    accessDeniedTitle: "Нет доступа",
    accessDeniedHint: "Права роли проверены на сервере",
    navigationLabel: "Основная навигация",
    moreLabel: "Ещё",
    menuTitle: "Все разделы",
    closeLabel: "Закрыть меню",
  },
  ky: {
    skip: "Негизги мазмунга өтүү",
    accessDeniedTitle: "Кирүүгө укук жок",
    accessDeniedHint: "Ролдун укуктары серверде текшерилди",
    navigationLabel: "Негизги навигация",
    moreLabel: "Дагы",
    menuTitle: "Бардык бөлүмдөр",
    closeLabel: "Менюну жабуу",
  },
  en: {
    skip: "Skip to main content",
    accessDeniedTitle: "Access denied",
    accessDeniedHint: "Role permissions were checked on the server",
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
  const fixtureMode = isUiContractFixtureMode();
  const legacyUser = fixtureMode ? await currentUser() : null;
  if (fixtureMode && !legacyUser) redirect("/login");

  const platformActor = fixtureMode ? null : await requirePlatformStaffActor();
  const roleCandidate = legacyUser?.role ?? platformActor?.role;
  if (!roleCandidate || !isStaffRole(roleCandidate)) {
    redirect(fixtureMode ? "/portal" : "/platform-pending?from=%2Fportal");
  }
  const role = roleCandidate;
  const user = {
    name: legacyUser?.name ?? platformActor?.displayName ?? "EVO",
    role,
  };
  const { t, locale } = await getT();
  const shellCopy = SHELL_COPY[locale];
  const notificationBatch: OperatorNotification[] =
    fixtureMode && legacyUser
      ? listOperatorNotificationsForActor(
          { id: legacyUser.id, role },
          OPERATOR_NOTIFICATION_LIMIT + 1,
        )
      : [];
  const notificationCountCapped =
    notificationBatch.length > OPERATOR_NOTIFICATION_LIMIT;
  const notifications = notificationBatch.slice(0, OPERATOR_NOTIFICATION_LIMIT);
  const integrations = fixtureMode ? await getIntegrationStatus() : null;

  const allowed = new Map(
    STAFF_NAV_ITEMS
      .filter((item) => fixtureMode || item.href === "/whatsapp")
      .filter((item) => (item.allowedRoles as readonly string[]).includes(role))
      .map((item) => [item.href as string, t(item.labelKey)] as const),
  );
  const groups: NavGroup[] = NAV_GROUP_DEFS
    .map((g) => ({
      label: t(g.key),
      items: g.hrefs.filter((h) => allowed.has(h)).map((h) => ({ href: h, label: allowed.get(h)! })),
    }))
    .filter((g) => g.items.length > 0);

  const titles: Record<string, { title: string; hint?: string }> = {
    "/access-denied": {
      title: shellCopy.accessDeniedTitle,
      hint: shellCopy.accessDeniedHint,
    },
    "/dashboard": { title: t("commandCenter"), hint: t("commandCenterHint") },
    "/sales": { title: t("admissionsPipeline"), hint: t("admissionsPipelineHint") },
    "/clients": { title: t("student360"), hint: t("student360Hint") },
    "/applications": { title: t("applicationQueue"), hint: t("applicationQueueHint") },
    "/documents": { title: t("documentQueue"), hint: t("documentQueueHint") },
    "/visa": { title: t("visaQueue"), hint: t("visaQueueHint") },
    "/whatsapp": { title: `${t("whatsapp")} · ${t("inbox")}` },
    "/calls": { title: t("callLog") },
    "/chat": { title: t("chat"), hint: t("channels") },
    "/notifications": { title: t("notifications"), hint: t("notificationsHint") },
    "/tasks": { title: t("taskBoard"), hint: t("taskBoardHint") },
    "/reports": { title: t("salesReport") },
    "/finance": { title: t("financeOverview"), hint: t("financeOverviewHint") },
    "/settings": { title: t("settings"), hint: t("adminOnly") },
  };

  return (
    <>
      <a href="#staff-main" className="skip-link">
        {shellCopy.skip}
      </a>
      <div className="staff-shell">
        <aside className="staff-sidebar">
          <Link
            href={fixtureMode ? "/dashboard" : "/whatsapp"}
            aria-label={t("appName")}
            className="staff-brand"
          >
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
          <TopBar
            titles={titles}
            locale={locale}
            role={role}
            homeHref={fixtureMode ? "/dashboard" : "/whatsapp"}
            addLabel={t("add")}
            themeLabel={t("toggleTheme")}
            notificationCount={notifications.length}
            notificationCountCapped={notificationCountCapped}
            integrationStatus={{
              amo:
                integrations?.amocrm.status === "configured"
                  ? "configured_not_verified"
                  : (integrations?.amocrm.status ?? "not_configured"),
              whatsapp:
                integrations?.whatsappState === "configured"
                  ? "configured_not_verified"
                  : (integrations?.whatsappState ?? "not_configured"),
            }}
            notificationPreview={notifications.slice(0, 3).map((item) => ({
              id: item.id,
              title: item.title,
              subject: item.subject,
              href: item.href,
            }))}
          />
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
