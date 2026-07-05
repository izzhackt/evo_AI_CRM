import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser, isStaff } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { logoutAction } from "@/lib/actions";
import { StaffNav, type NavGroup } from "@/components/StaffNav";
import { TopBar } from "@/components/TopBar";
import { Icon } from "@/components/icons";
import { STAFF_NAV_ITEMS } from "@/lib/domain";

const NAV_GROUP_DEFS = [
  { key: "navOperations", hrefs: ["/dashboard", "/sales", "/clients", "/applications", "/documents"] },
  { key: "navCommunications", hrefs: ["/whatsapp", "/calls", "/chat"] },
  { key: "navAnalytics", hrefs: ["/tasks", "/reports", "/finance"] },
  { key: "navSystem", hrefs: ["/settings"] },
] as const;

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!isStaff(user.role)) redirect("/portal");
  const { t, locale } = await getT();

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
    <div className="min-h-screen bg-bg lg:grid lg:grid-cols-[248px_1fr]">
      <aside className="border-b border-border bg-surface lg:sticky lg:top-0 lg:h-screen lg:border-b-0 lg:border-r">
        <div className="flex h-full flex-col">
          <Link href="/dashboard" className="flex items-center gap-3 px-5 py-4">
            <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[9px] bg-accent text-[16px] font-bold text-on-accent">
              E
            </span>
            <span className="leading-tight">
              <span className="block text-[15px] font-bold text-fg">EVO</span>
              <span className="block text-[11px] text-fg-3">Admissions CRM</span>
            </span>
          </Link>

          <StaffNav groups={groups} />

          <div className="mt-auto flex items-center gap-3 border-t border-border px-4 py-3.5">
            <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full bg-accent-weak text-[12px] font-semibold text-accent">
              {initials(user.name)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold text-fg">{user.name}</div>
              <div className="truncate text-[11.5px] text-fg-3">{t(`role.${user.role}`)}</div>
            </div>
            <form action={logoutAction}>
              <button
                type="submit"
                aria-label={t("logout")}
                title={t("logout")}
                className="grid h-9 w-9 place-items-center rounded-nav text-fg-3 transition-[background-color,color] duration-150 hover:bg-danger-weak hover:text-danger focus:outline-none"
              >
                <Icon name="log-out" size={18} />
              </button>
            </form>
          </div>
        </div>
      </aside>

      <div className="min-w-0">
        <TopBar titles={titles} locale={locale} addLabel={t("add")} themeLabel={t("toggleTheme")} />
        <main className="mx-auto w-full max-w-[1280px] px-5 py-7 sm:px-7">
          <div className="page-in">{children}</div>
        </main>
      </div>
    </div>
  );
}
