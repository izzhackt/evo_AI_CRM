import Link from "next/link";
import { getT } from "@/lib/i18n";
import { allApplications, type ApplicationQueueRow } from "@/lib/queries";
import { APP_STATUSES } from "@/lib/db";
import { setApplicationStatusAction } from "@/lib/actions";
import { requireStaffRoute } from "@/lib/guards";
import { Badge, Card, EmptyState, btnGhostCls, cn } from "@/components/ui";
import {
  ContextBanner,
  QueueMetrics,
} from "@/components/platform/operations/OperationsPrimitives";

const selectCls =
  "h-10 rounded-nav border border-border-strong bg-surface px-2 text-[12px] text-fg focus-visible:border-accent";

function StatusForm({
  app,
  t,
}: {
  app: ApplicationQueueRow;
  t: (key: string) => string;
}) {
  return (
    <form action={setApplicationStatusAction} className="flex min-w-0 items-center gap-1.5">
      <input type="hidden" name="id" value={app.id} />
      <input type="hidden" name="client_id" value={app.client_id} />
      <label className="sr-only" htmlFor={`application-status-${app.id}`}>
        {t("status")}
      </label>
      <select
        id={`application-status-${app.id}`}
        name="status"
        defaultValue={app.status}
        className={cn(selectCls, "min-w-0 flex-1")}
      >
        {APP_STATUSES.map((value) => (
          <option key={value} value={value}>
            {t(`app.${value}`)}
          </option>
        ))}
      </select>
      <button type="submit" className={btnGhostCls}>
        {t("save")}
      </button>
    </form>
  );
}

export default async function ApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireStaffRoute("/applications");
  const { t } = await getT();
  const { status } = await searchParams;
  const selectedStatus =
    status && (APP_STATUSES as readonly string[]).includes(status) ? status : undefined;
  const applications = allApplications({ status: selectedStatus });
  const allRows = selectedStatus ? allApplications() : applications;
  const today = new Date().toISOString().slice(0, 10);
  const statusCount = (value: string) => allRows.filter((app) => app.status === value).length;
  const overdue = allRows.filter(
    (app) =>
      !!app.deadline &&
      app.deadline < today &&
      app.status !== "enrolled" &&
      app.status !== "rejected",
  ).length;
  const readyForDecision = allRows.filter((app) => app.status === "submitted" || app.status === "offer").length;
  const openDocuments = allRows.reduce((sum, app) => sum + app.document_open, 0);

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
      <ContextBanner
        title={t("operationalStageNotice")}
        description={t("operationalStageHint")}
        tone="info"
      />

      <QueueMetrics
        items={[
          { label: t("activeApplications"), value: allRows.length, tone: "accent" },
          { label: t("attentionRequired"), value: overdue, tone: overdue ? "danger" : "ok" },
          { label: t("documentsInReview"), value: openDocuments, tone: openDocuments ? "warn" : "ok" },
          { label: t("readiness"), value: readyForDecision, meta: t("status"), tone: "info" },
        ]}
      />

      <nav aria-label={t("applicationStatuses")} className="flex flex-wrap gap-2">
        {pills.map((pill) => (
          <Link
            key={pill.value || "all"}
            href={pill.href}
            aria-current={pill.active ? "page" : undefined}
            className={cn(
              "inline-flex min-h-10 items-center gap-2 rounded-full px-3 text-[12.5px] font-medium transition-[background-color,color]",
              pill.active ? "bg-accent text-on-accent" : "bg-surface-2 text-fg-2 hover:text-fg",
            )}
          >
            {pill.label}
            <span className={cn("font-mono text-[11.5px]", pill.active ? "text-on-accent/80" : "text-fg-3")}>
              {pill.count}
            </span>
          </Link>
        ))}
      </nav>

      {applications.length === 0 ? (
        <Card>
          <EmptyState text={selectedStatus ? t("noFilteredApplications") : t("noApplications")} />
        </Card>
      ) : (
        <>
          <div className="grid gap-3 md:hidden">
            {applications.map((app) => {
              const isOverdue =
                !!app.deadline &&
                app.deadline < today &&
                app.status !== "enrolled" &&
                app.status !== "rejected";
              return (
                <article key={app.id} className="rounded-card border border-border bg-surface p-4 shadow-evo">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link href={`/applications/${app.id}`} className="font-bold text-fg hover:text-accent">
                        {app.university}
                      </Link>
                      <p className="mt-1 text-[12.5px] text-fg-3">
                        {[app.program, app.degree, app.country].filter(Boolean).join(" · ") || "—"}
                      </p>
                    </div>
                    <Badge value={app.status} label={t(`app.${app.status}`)} />
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3 text-[12px]">
                    <div>
                      <span className="text-fg-3">{t("client")}</span>
                      <Link href={`/clients/${app.client_id}`} className="mt-0.5 block font-semibold text-fg hover:text-accent">
                        {app.client_name}
                      </Link>
                    </div>
                    <div>
                      <span className="text-fg-3">{t("deadline")}</span>
                      <p className={cn("mt-0.5 font-mono font-semibold", isOverdue ? "text-danger" : "text-fg")}>
                        {app.deadline ?? "—"}
                      </p>
                    </div>
                    <div>
                      <span className="text-fg-3">{t("documents")}</span>
                      <p className="mt-0.5 font-semibold text-fg">
                        {app.document_total - app.document_open}/{app.document_total}
                      </p>
                    </div>
                    <div>
                      <span className="text-fg-3">{t("openTasks")}</span>
                      <p className="mt-0.5 font-semibold text-fg">{app.open_tasks}</p>
                    </div>
                  </div>
                  <div className="mt-4 border-t border-border pt-3">
                    <StatusForm app={app} t={t} />
                  </div>
                </article>
              );
            })}
          </div>

          <Card bodyClassName="px-0 py-0" className="hidden md:block">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px] text-left text-[13px]">
                <thead className="border-b border-border bg-surface-2 text-[11px] uppercase tracking-[0.04em] text-fg-3">
                  <tr>
                    <th className="px-5 py-3 font-semibold">{t("client")}</th>
                    <th className="px-4 py-3 font-semibold">{t("university")}</th>
                    <th className="px-4 py-3 font-semibold">{t("readiness")}</th>
                    <th className="px-4 py-3 font-semibold">{t("deadline")}</th>
                    <th className="px-5 py-3 font-semibold">{t("status")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {applications.map((app) => {
                    const isOverdue =
                      !!app.deadline &&
                      app.deadline < today &&
                      app.status !== "enrolled" &&
                      app.status !== "rejected";
                    return (
                      <tr key={app.id} className="align-middle transition-[background-color] hover:bg-surface-2">
                        <td className="px-5 py-3">
                          <Link href={`/clients/${app.client_id}`} className="font-semibold text-fg hover:text-accent">
                            {app.client_name}
                          </Link>
                          <div className="mt-1">
                            <Badge value={app.stage} label={t(`stage.${app.stage}`)} />
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <Link href={`/applications/${app.id}`} className="font-semibold text-fg hover:text-accent">
                            {app.university}
                          </Link>
                          <div className="mt-0.5 text-[12px] text-fg-3">
                            {[app.program, app.degree, app.country].filter(Boolean).join(" · ") || "—"}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-mono text-[12px] text-fg">
                            {app.document_total - app.document_open}/{app.document_total} {t("documents")}
                          </div>
                          <div className="mt-1 text-[11.5px] text-fg-3">
                            {app.open_tasks} {t("openTasks")} · {app.pending_payments} {t("payments")}
                          </div>
                        </td>
                        <td className={cn("px-4 py-3 font-mono text-[12.5px]", isOverdue ? "font-bold text-danger" : "text-fg-2")}>
                          {app.deadline ?? "—"}
                        </td>
                        <td className="px-5 py-3">
                          <StatusForm app={app} t={t} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
