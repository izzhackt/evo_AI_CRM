import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { allApplications } from "@/lib/queries";
import { APP_STATUSES } from "@/lib/db";
import { setApplicationStatusAction } from "@/lib/actions";
import { Badge, Card, EmptyState, StatCard, btnGhostCls, inputCls } from "@/components/ui";

export default async function ApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const user = await currentUser();
  if (!user || user.role === "finance") redirect("/dashboard");

  const { t } = await getT();
  const { status } = await searchParams;
  const selectedStatus = status && (APP_STATUSES as readonly string[]).includes(status) ? status : undefined;
  const applications = allApplications({ status: selectedStatus });
  const allRows = selectedStatus ? allApplications() : applications;
  const statusCount = (value: string) => allRows.filter((app) => app.status === value).length;
  const dueSoon = allRows.filter(
    (app) => app.deadline && app.status !== "enrolled" && app.status !== "rejected",
  ).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">{t("applicationQueue")}</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">{t("applicationQueueHint")}</p>
        </div>
        <Link href="/clients" className={btnGhostCls}>{t("student360")}</Link>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={t("activeApplications")} value={statusCount("preparing") + statusCount("submitted")} href="/applications" />
        <StatCard label={t("dueApplications")} value={dueSoon} />
        <StatCard label={t("offers")} value={statusCount("offer")} href="/applications?status=offer" />
        <StatCard label={t("enrolled")} value={statusCount("enrolled")} href="/applications?status=enrolled" />
      </div>

      <Card title={t("applicationQueue")}>
        <form className="mb-4 flex flex-wrap gap-2">
          <select name="status" defaultValue={selectedStatus ?? ""} className={`${inputCls} max-w-52`}>
            <option value="">{t("allStatuses")}</option>
            {APP_STATUSES.map((value) => (
              <option key={value} value={value}>{t(`app.${value}`)}</option>
            ))}
          </select>
          <button type="submit" className={btnGhostCls}>{t("search")}</button>
          {selectedStatus && <Link href="/applications" className={btnGhostCls}>{t("clearFilter")}</Link>}
        </form>

        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">{t("university")}</th>
                <th className="px-4 py-3">{t("client")}</th>
                <th className="px-4 py-3">{t("program")}</th>
                <th className="px-4 py-3">{t("deadline")}</th>
                <th className="px-4 py-3">{t("status")}</th>
                <th className="px-4 py-3">{t("operationalContext")}</th>
                <th className="px-4 py-3">{t("manager")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {applications.map((app) => (
                <tr key={app.id} className="align-top transition hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link href={`/clients/${app.client_id}`} className="font-medium text-slate-900 hover:text-indigo-700 hover:underline">
                      {app.university}
                    </Link>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {[app.country, app.degree].filter(Boolean).join(" · ") || t("notAssigned")}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/clients/${app.client_id}`} className="font-medium text-indigo-700 hover:underline">
                      {app.client_name}
                    </Link>
                    <div className="mt-1"><Badge value={app.stage} label={t(`stage.${app.stage}`)} /></div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{app.program ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {app.deadline ?? "—"}
                    <div className="mt-0.5 text-xs text-slate-400">{t("updatedAt")}: {app.updated_at}</div>
                  </td>
                  <td className="px-4 py-3">
                    <form action={setApplicationStatusAction} className="flex min-w-44 items-center gap-2">
                      <input type="hidden" name="id" value={app.id} />
                      <input type="hidden" name="client_id" value={app.client_id} />
                      <select name="status" defaultValue={app.status} className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs">
                        {APP_STATUSES.map((value) => (
                          <option key={value} value={value}>{t(`app.${value}`)}</option>
                        ))}
                      </select>
                      <button type="submit" className={btnGhostCls}>{t("save")}</button>
                    </form>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    <div>{t("openDocuments")}: {app.document_open}/{app.document_total}</div>
                    <div>{t("openTasks")}: {app.open_tasks}</div>
                    <div>{t("pendingPayments")}: {app.pending_payments}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{app.manager_name ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {applications.length === 0 && (
            <EmptyState text={selectedStatus ? t("noFilteredApplications") : t("noApplications")} />
          )}
        </div>
      </Card>
    </div>
  );
}
