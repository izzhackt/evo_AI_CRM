import Link from "next/link";
import type { ComponentType } from "react";

import { Icon } from "@/components/icons";
import { MobileStaffNav, StaffNav, type MobileNavCopy, type NavGroup } from "@/components/StaffNav";
import { TopBar } from "@/components/TopBar";
import { EvoWordmark } from "@/components/platform/EvoWordmark";
import {
  logoutStaffAction,
  selectStaffRolePreviewAction,
} from "@/lib/staff-auth-actions";
import { STAFF_NAV_ITEMS, isStaffRole } from "@/lib/domain";
import {
  FIXED_ROLE_ROUTES,
  isFixedRole,
  type FixedRole,
} from "@/lib/fixed-role-policy";
import { getT } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n-data";
import type { StaffRole } from "@/lib/roles";
import { formatReleaseLabel, readReleaseMetadata } from "@/lib/release-metadata";
import {
  providerDisplayStatus,
  type ProviderDisplayStatus,
} from "@/lib/provider-display-status";
import { getPlatformWahaSessionHealth } from "@/lib/platform-communications";
import { readCanonicalAmoCrmProviderAvailability } from "@/lib/server/canonical-amocrm-provider-config";
import {
  platformWahaHealthDisplayStatus,
  readPlatformGeminiProviderAvailability,
} from "@/lib/server/platform-provider-readiness";

const NAV_GROUP_DEFS = [
  { key: "navOperations", hrefs: ["/dashboard", "/sales", "/clients", "/applications", "/documents", "/visa"] },
  { key: "navCommunications", hrefs: ["/whatsapp"] },
  { key: "navAnalytics", hrefs: ["/tasks", "/finance"] },
  { key: "navSystem", hrefs: ["/settings"] },
] as const;

const SHELL_COPY: Record<
  Locale,
  MobileNavCopy & {
    skip: string;
    accessDeniedTitle: string;
  }
> = {
  ru: {
    skip: "Перейти к основному содержимому",
    accessDeniedTitle: "Нет доступа",
    navigationLabel: "Основная навигация",
    moreLabel: "Ещё",
    menuTitle: "Все разделы",
    closeLabel: "Закрыть меню",
  },
  ky: {
    skip: "Негизги мазмунга өтүү",
    accessDeniedTitle: "Кирүүгө укук жок",
    navigationLabel: "Негизги навигация",
    moreLabel: "Дагы",
    menuTitle: "Бардык бөлүмдөр",
    closeLabel: "Менюну жабуу",
  },
  en: {
    skip: "Skip to main content",
    accessDeniedTitle: "Access denied",
    navigationLabel: "Primary navigation",
    moreLabel: "More",
    menuTitle: "All sections",
    closeLabel: "Close menu",
  },
};

type ShellProvider = {
  user: {
    name: string;
    role: StaffRole;
    authorityRole: FixedRole;
  };
  homeHref: string;
  availableRoutes: ReadonlySet<string> | null;
  logout: () => Promise<void>;
  LanguageSwitcher: ComponentType<{ current: Locale }>;
  integrationStatus: {
    ai: ProviderDisplayStatus;
    amo: ProviderDisplayStatus;
    whatsapp: ProviderDisplayStatus;
  };
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

async function loadShellProvider(): Promise<ShellProvider> {
  const [guards, language] = await Promise.all([
    import("@/lib/platform-guards"),
    import("@/components/platform/PlatformLangSwitcher"),
  ]);
  const actor = await guards.requirePlatformStaffActor();
  if (
    !isFixedRole(actor.presentationRole) ||
    !isStaffRole(actor.presentationRole)
  ) {
    throw new Error("fixed_role_shell_received_unsupported_role");
  }
  const amoAvailability = readCanonicalAmoCrmProviderAvailability();
  const geminiAvailability = readPlatformGeminiProviderAvailability();
  const wahaSessionHealth = await getPlatformWahaSessionHealth(actor, "crm_primary");

  return {
    user: {
      name: actor.displayName,
      role: actor.presentationRole,
      authorityRole: actor.authorityRole,
    },
    homeHref: guards.platformHomeRoute(actor.presentationRole),
    availableRoutes: new Set(FIXED_ROLE_ROUTES),
    logout: logoutStaffAction,
    LanguageSwitcher: language.PlatformLangSwitcher,
    integrationStatus: {
      ai: providerDisplayStatus(geminiAvailability),
      amo: providerDisplayStatus(amoAvailability),
      whatsapp: platformWahaHealthDisplayStatus(wahaSessionHealth),
    },
  };
}

export default async function StaffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [provider, { t, locale }] = await Promise.all([
    loadShellProvider(),
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
        .map((href) => ({ href, label: allowed.get(href)! })),
    }))
    .filter((group) => group.items.length > 0);

  const titles: Record<string, { title: string }> = {
    "/access-denied": {
      title: shellCopy.accessDeniedTitle,
    },
    "/dashboard": { title: t("commandCenter") },
    "/sales": { title: t("admissionsPipeline") },
    "/clients": { title: t("student360") },
    "/applications": { title: t("applicationQueue") },
    "/documents": { title: t("documentQueue") },
    "/visa": { title: t("visaQueue") },
    "/whatsapp": { title: `${t("whatsapp")} · ${t("inbox")}` },
    "/tasks": { title: t("taskBoard") },
    "/finance": { title: t("financeOverview") },
    "/settings": { title: t("settings") },
  };
  const LanguageSwitcher = provider.LanguageSwitcher;
  const releaseLabel = formatReleaseLabel(readReleaseMetadata());
  const account = (
    <div>
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
      <div className="staff-release staff-release--mobile" title={releaseLabel}>
        {releaseLabel}
      </div>
    </div>
  );

  return (
    <>
      <a href="#staff-main" className="skip-link">
        {shellCopy.skip}
      </a>
      <div
        className="staff-shell"
        data-testid="staff-shell"
        data-authority-role={provider.user.authorityRole}
        data-effective-role={provider.user.role}
      >
        <aside className="staff-sidebar">
          <Link
            href={provider.homeHref}
            aria-label={t("appName")}
            className="staff-brand"
          >
            <EvoWordmark inverted />
          </Link>

          <StaffNav groups={groups} label={shellCopy.navigationLabel} />

          <div className="staff-release" title={releaseLabel}>
            {releaseLabel}
          </div>

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
            homeHref={provider.homeHref}
            themeLabel={t("toggleTheme")}
            languageSwitcher={<LanguageSwitcher current={locale} />}
            integrationStatus={provider.integrationStatus}
          />
          {provider.user.authorityRole === "admin" ? (
            <section
              data-testid="staff-role-preview"
              data-effective-role={provider.user.role}
              className="mx-4 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-card border border-accent/25 bg-accent-weak px-4 py-3 sm:mx-6"
            >
              <p className="text-sm font-semibold text-fg">
                Admin preview: {provider.user.role}
              </p>
              <form action={selectStaffRolePreviewAction} className="flex flex-wrap gap-2">
                {(["admin", "sales", "admissions"] as const).map((role) => (
                  <button
                    key={role}
                    type="submit"
                    name="role"
                    value={role}
                    aria-pressed={provider.user.role === role}
                    className="min-h-10 rounded-ctl border border-control-edge bg-surface px-3 text-xs font-semibold aria-pressed:border-accent aria-pressed:bg-accent aria-pressed:text-on-accent"
                  >
                    {role}
                  </button>
                ))}
              </form>
            </section>
          ) : null}
          <main
            id="staff-main"
            tabIndex={-1}
            /*
             * The shell publishes how much vertical room it has already taken,
             * because only the shell knows: the admin role preview above adds
             * a band that the other two roles never see. A pane that reserves
             * a constant is right for whichever role it was measured on and
             * wrong for the rest -- 19rem left sales and admissions with 116px
             * of dead viewport. Expressed in px because the chrome it
             * offsets is px-fixed, so a rem value would grow with the
             * browser root while the bar it accounts for did not.
             */
            style={
              {
                "--staff-chrome":
                  provider.user.authorityRole === "admin" ? "304px" : "224px",
              } as React.CSSProperties
            }
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
