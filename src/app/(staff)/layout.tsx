import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser, isStaff } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { logoutAction } from "@/lib/actions";
import { LangSwitcher } from "@/components/LangSwitcher";

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!isStaff(user.role)) redirect("/portal");
  const { t, locale } = await getT();

  const baseNav = [
    { href: "/dashboard", label: t("dashboard") },
    { href: "/sales", label: t("sales") },
    { href: "/clients", label: t("clients") },
    { href: "/whatsapp", label: t("whatsapp") },
    { href: "/calls", label: t("calls") },
    { href: "/tasks", label: t("tasks") },
    { href: "/chat", label: t("chat") },
  ];
  const admissionsNav = user.role === "finance" ? [] : [
    { href: "/applications", label: t("applications") },
    { href: "/documents", label: t("documents") },
  ];
  const reportsNav = user.role === "admin" || user.role === "sales" || user.role === "finance"
    ? [{ href: "/reports", label: t("reports") }]
    : [];
  const financeNav = [{ href: "/finance", label: t("finance") }];
  const settingsNav = user.role === "admin" ? [{ href: "/settings", label: t("settings") }] : [];
  const nav = [...baseNav.slice(0, 3), ...admissionsNav, ...baseNav.slice(3), ...reportsNav, ...financeNav, ...settingsNav];

  return (
    <div className="min-h-screen bg-[var(--evo-bg)] lg:grid lg:grid-cols-[260px_1fr]">
      <aside className="border-b border-[var(--evo-border)] bg-white lg:sticky lg:top-0 lg:h-screen lg:border-b-0 lg:border-r">
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 lg:block">
            <Link href="/dashboard" className="block">
              <span className="text-xs font-semibold uppercase text-blue-600">EVO CRM</span>
              <span className="mt-1 block text-lg font-semibold text-slate-950">{t("appName")}</span>
            </Link>
            <div className="lg:hidden">
              <LangSwitcher current={locale} />
            </div>
          </div>

          <nav className="flex gap-1 overflow-x-auto px-3 py-3 lg:flex-1 lg:flex-col lg:overflow-visible lg:px-3 lg:py-4">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="whitespace-nowrap rounded-md px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-blue-50 hover:text-blue-700 lg:w-full"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="hidden border-t border-slate-100 px-5 py-4 lg:block">
            <div className="text-sm font-semibold text-slate-900">{user.name}</div>
            <div className="mt-0.5 text-xs text-slate-500">{t(`role.${user.role}`)}</div>
          </div>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-10 border-b border-[var(--evo-border)] bg-white/95 backdrop-blur">
          <div className="flex min-h-16 items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <div>
              <div className="text-xs font-semibold uppercase text-slate-400">{t(`role.${user.role}`)}</div>
              <div className="text-sm font-semibold text-slate-900 sm:text-base">{user.name}</div>
            </div>
            <div className="flex items-center gap-3">
              <div className="hidden sm:block">
                <LangSwitcher current={locale} />
              </div>
              <form action={logoutAction}>
                <button className="h-9 rounded-md border border-[var(--evo-border-strong)] bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700">
                  {t("logout")}
                </button>
              </form>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
