import Link from "next/link";
import { redirect } from "next/navigation";
import type { ComponentType } from "react";

import { Icon } from "@/components/icons";
import { MobileStaffNav, StaffNav, type MobileNavCopy, type NavGroup } from "@/components/StaffNav";
import { TopBar } from "@/components/TopBar";
import { EvoWordmark } from "@/components/platform/EvoWordmark";
import { STAFF_NAV_ITEMS, isStaffRole } from "@/lib/domain";
import { getT } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n-data";
import type { StaffRole } from "@/lib/roles";
import { isUiContractFixtureMode } from "@/lib/runtime-mode";

const NAV_GROUP_DEFS = [
  { key: "navOperations", hrefs: ["/dashboard", "/sales", "/admissions", "/clients", "/applications", "/documents", "/visa"] },
  { key: "navCommunications", hrefs: ["/whatsapp", "/calls", "/chat", "/notifications"] },
  { key: "navAnalytics", hrefs: ["/tasks", "/reports", "/finance"] },
  { key: "navSystem", hrefs: ["/settings"] },
] as const;

const CONNECTED_STAFF_ROUTES = new Set([
  "/sales",
  "/clients",
  "/applications",
  "/whatsapp",
]);

const PLATFORM_AUDIT_SETTINGS_HREF = "/settings?tab=audit";

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

type ShellNotification = {
  id: string;
  title: string;
  subject: string | null;
  href: string;
};

type ShellProvider = {
  user: {
    name: string;
    role: StaffRole;
  };
  homeHref: string;
  availableRoutes: ReadonlySet<string> | null;
  logout: () => Promise<void>;
  LanguageSwitcher: ComponentType<{ current: Locale }>;
  notifications: ShellNotification[];
  notificationCountCapped: boolean;
  integrationStatus: {
    amo: "not_configured" | "configured_not_verified" | "blocked";
    whatsapp: "not_configured" | "configured_not_verified" | "blocked";
  };
  connectedRoutesOnly: boolean;
};

function initials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase() ?? "")
      .join("") || "EV"
  );
}

async function loadFixtureShellProvider(): Promise<ShellProvider> {
  const [auth, actions, queries, language] = await Promise.all([
    import("@/lib/auth"),
    import("@/lib/actions"),
    import("@/lib/queries"),
    import("@/components/LangSwitcher"),
  ]);
  const user = await auth.currentUser();
  if (!user) redirect("/login");
  if (!isStaffRole(user.role)) redirect("/portal");

  const notificationBatch = queries.listOperatorNotificationsForActor(
    { id: user.id, role: user.role },
    queries.OPERATOR_NOTIFICATION_LIMIT + 1,
  );
  const integrations = await actions.getIntegrationStatus();

  return {
    user: { name: user.name, role: user.role },
    homeHref: "/dashboard",
    availableRoutes: null,
    logout: actions.logoutAction,
    LanguageSwitcher: language.LangSwitcher,
    notifications: notificationBatch.slice(0, queries.OPERATOR_NOTIFICATION_LIMIT),
    notificationCountCapped:
      notificationBatch.length > queries.OPERATOR_NOTIFICATION_LIMIT,
    integrationStatus: {
      amo:
        integrations.amocrm.status === "configured"
          ? "configured_not_verified"
          : integrations.amocrm.status,
      whatsapp:
        integrations.whatsappState === "configured"
          ? "configured_not_verified"
          : integrations.whatsappState,
    },
    connectedRoutesOnly: false,
  };
}

async function loadConnectedShellProvider(): Promise<ShellProvider> {
  const [guards, actions, language, auditConfig] = await Promise.all([
    import("@/lib/platform-guards"),
    import("@/lib/platform-admissions-actions"),
    import("@/components/platform/PlatformLangSwitcher"),
    import("@/lib/platform-audit-config"),
  ]);
  const actor = await guards.requirePlatformStaffActor();
  if (!isStaffRole(actor.role)) {
    redirect("/platform-pending?from=%2Fportal");
  }

  return {
    user: { name: actor.displayName, role: actor.role },
    homeHref: guards.platformHomeRoute(actor.platformRole),
    availableRoutes: new Set([
      ...CONNECTED_STAFF_ROUTES,
      ...(auditConfig.isPlatformP7AAuditEnabled() ? ["/settings"] : []),
    ]),
    logout: actions.logoutPlatformAction,
    LanguageSwitcher: language.PlatformLangSwitcher,
    notifications: [],
    notificationCountCapped: false,
    integrationStatus: {
      amo: "blocked",
      whatsapp: "blocked",
    },
    connectedRoutesOnly: true,
  };
}

export default async function StaffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const fixtureMode = isUiContractFixtureMode();
  const [provider, { t, locale }] = await Promise.all([
    fixtureMode ? loadFixtureShellProvider() : loadConnectedShellProvider(),
    getT(),
  ]);
  const shellCopy = SHELL_COPY[locale];
  const allowed = new Map(
    STAFF_NAV_ITEMS
      .filter(
        (item) =>
          !provider.availableRoutes || provider.availableRoutes.has(item.href),
      )
      .filter((item) =>
        (item.allowedRoles as readonly string[]).includes(provider.user.role),
      )
      .map((item) => [item.href as string, t(item.labelKey)] as const),
  );
  const groups: NavGroup[] = NAV_GROUP_DEFS
    .map((group) => ({
      label: t(group.key),
      items: group.hrefs
        .filter((href) => allowed.has(href))
        .map((href) => ({
          href:
            provider.connectedRoutesOnly && href === "/settings"
              ? PLATFORM_AUDIT_SETTINGS_HREF
              : href,
          label: allowed.get(href)!,
        })),
    }))
    .filter((group) => group.items.length > 0);

  const titles: Record<string, { title: string; hint?: string }> = {
    "/access-denied": {
      title: shellCopy.accessDeniedTitle,
      hint: shellCopy.accessDeniedHint,
    },
    "/dashboard": { title: t("commandCenter"), hint: t("commandCenterHint") },
    "/sales": { title: t("admissionsPipeline"), hint: t("admissionsPipelineHint") },
    "/admissions": { title: t("admissions"), hint: t("admissionsHint") },
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
  const LanguageSwitcher = provider.LanguageSwitcher;
  const account = (
    <div className="mobile-menu-account">
      <span className="staff-account__avatar">
        {initials(provider.user.name)}
      </span>
      <div className="staff-account__copy">
        <div>{provider.user.name}</div>
        <span>{t(`role.${provider.user.role}`)}</span>
      </div>
      <form action={provider.logout}>
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
          <Link
            href={provider.homeHref}
            aria-label={t("appName")}
            className="staff-brand"
          >
            <EvoWordmark inverted />
          </Link>

          <StaffNav groups={groups} label={shellCopy.navigationLabel} />

          <div className="staff-account">
            <span className="staff-account__avatar">
              {initials(provider.user.name)}
            </span>
            <div className="staff-account__copy">
              <div>{provider.user.name}</div>
              <span>{t(`role.${provider.user.role}`)}</span>
            </div>
            <form action={provider.logout}>
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
            role={provider.user.role}
            homeHref={provider.homeHref}
            addLabel={t("add")}
            themeLabel={t("toggleTheme")}
            languageSwitcher={<LanguageSwitcher current={locale} />}
            notificationCount={provider.notifications.length}
            notificationCountCapped={provider.notificationCountCapped}
            integrationStatus={provider.integrationStatus}
            notificationPreview={provider.notifications.slice(0, 3)}
            connectedRoutesOnly={provider.connectedRoutesOnly}
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
