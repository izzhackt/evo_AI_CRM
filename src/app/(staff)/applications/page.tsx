import Link from "next/link";
import { getT } from "@/lib/i18n";
import { allApplications } from "@/lib/queries";
import { APP_STATUSES } from "@/lib/db";
import { setApplicationStatusAction } from "@/lib/actions";
import { requireStaffRoute } from "@/lib/guards";
import { Badge, Card, EmptyState, btnGhostCls, cn } from "@/components/ui";

const selectCls = "rounded-nav border border-border-strong bg-surface-2 px-2 py-1.5 text-[12px] text-fg focus:border-accent focus:outline-none";

export default async function ApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireStaffRoute("/applications");
  const { t } = await getT();
  const { status } = await searchParams;
  const selectedStatus = status && (APP_STATUSES as readonly string[]).includes(status) ? status : undefined;
  const applications = allApplications({ status: selectedStatus });
  const allRows = selectedStatus ? allApplications() : applications;
  const statusCount = (value: string) => allRows.filter((app) => app.status === value).length;

  const pills = [
    { value: "", label: t("all"), count: allRows.length, active: !selectedStatus, href: "/applications" },
    ...APP_STATUSES.map((value) => ({
      value,
      label: t(`app.${value}`),
      count: statusCount(value),
      active: selectedStatus === value,
      href: `/applications?status=${value}`,
    })),
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {pills.map((p) => (
          <Link
            key={p.value || "all"}
            href={p.href}
            className={cn(
              "inline-flex min-h-9 items-center gap-2 rounded-full px-3 text-[12.5px] font-medium transition-[background-color,color] duration-150",
              p.active ? "bg-accent text-on-accent" : "bg-surface-2 text-fg-2 hover:text-fg",
            )}
          >
            {p.label}
            <span className={cn("font-mono text-[11.5px]", p.active ? "text-on-accent/80" : "text-fg-3")}>{p.count}</span>
          </Link>
        ))}
      </div>

      <Card bodyClassName="px-0 py-0">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-border bg-surface-2 text-[11px] uppercase tracking-[0.04em] text-fg-3">
              <tr>
                <th className="px-5 py-3 font-semibold">{t("client")}</th>
                <th className="px-4 py-3 font-semibold">{t("university")}</th>
                <th className="px-4 py-3 font-semibold">{t("program")}</th>
                <th className="px-4 py-3 font-semibold">{t("deadline")}</th>
                <th className="px-5 py-3 font-semibold">{t("status")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {applications.map((app) => (
                <tr key={app.id} className="align-middle transition-[background-color] hover:bg-surface-2">
                  <td className="px-5 py-3">
                    <Link href={`/clients/${app.client_id}`} className="font-semibold text-fg hover:text-accent">
                      {app.client_name}
                    </Link>
                    <div className="mt-1"><Badge value={app.stage} label={t(`stage.${app.stage}`)} /></div>
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/clients/${app.client_id}`} className="font-medium text-fg hover:text-accent">
                      {app.university}
                    </Link>
                    <div className="mt-0.5 text-[12px] text-fg-3">{[app.country, app.degree].filter(Boolean).join(" · ") || "—"}</div>
                  </td>
                  <td className="px-4 py-3 text-fg-2">{app.program ?? "—"}</td>
                  <td className="px-4 py-3 font-mono text-[12.5px] text-fg-2">{app.deadline ?? "—"}</td>
                  <td className="px-5 py-3">
                    <form action={setApplicationStatusAction} className="flex min-w-44 items-center gap-1.5">
                      <input type="hidden" name="id" value={app.id} />
                      <input type="hidden" name="client_id" value={app.client_id} />
                      <select name="status" defaultValue={app.status} className={cn(selectCls, "w-full")}>
                        {APP_STATUSES.map((value) => (
                          <option key={value} value={value}>{t(`app.${value}`)}</option>
                        ))}
                      </select>
                      <button type="submit" className={btnGhostCls}>{t("save")}</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {applications.length === 0 && (
          <div className="px-5 py-4"><EmptyState text={selectedStatus ? t("noFilteredApplications") : t("noApplications")} /></div>
        )}
      </Card>
    </div>
  );
}
