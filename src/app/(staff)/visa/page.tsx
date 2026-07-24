import Link from "next/link";
import { getT } from "@/lib/i18n";
import { allVisaCases, listClients, type VisaQueueRow } from "@/lib/queries";
import { VISA_STATUSES } from "@/lib/db";
import { upsertVisaCaseAction } from "@/lib/actions";
import { requireStaffRoute } from "@/lib/guards";
import { Badge, Card, EmptyState, btnCls, btnGhostCls, cn, inputCls, labelCls } from "@/components/ui";
import {
  ContextBanner,
  QueueMetrics,
} from "@/components/platform/operations/OperationsPrimitives";

function VisaStatusForm({
  visaCase,
  t,
}: {
  visaCase: VisaQueueRow;
  t: (key: string) => string;
}) {
  return (
    <form action={upsertVisaCaseAction} className="flex min-w-0 items-center gap-1.5">
      <input type="hidden" name="client_id" value={visaCase.client_id} />
      <input type="hidden" name="country" value={visaCase.country} />
      <input type="hidden" name="appointment_at" value={visaCase.appointment_at ?? ""} />
      <input type="hidden" name="notes" value={visaCase.notes ?? ""} />
      <label className="sr-only" htmlFor={`visa-status-${visaCase.id}`}>
        {t("status")}
      </label>
      <select
        id={`visa-status-${visaCase.id}`}
        name="status"
        defaultValue={visaCase.status}
        className="h-10 min-w-0 flex-1 rounded-nav border border-border-strong bg-surface px-2 text-[12px] text-fg focus-visible:border-accent"
      >
        {VISA_STATUSES.map((value) => (
          <option key={value} value={value}>
            {t(`visa.${value}`)}
          </option>
        ))}
      </select>
      <button type="submit" className={btnGhostCls}>
        {t("save")}
      </button>
    </form>
  );
}

export default async function VisaPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireStaffRoute("/visa");
  const { t } = await getT();
  const { status } = await searchParams;
  const selectedStatus =
    status && (VISA_STATUSES as readonly string[]).includes(status) ? status : undefined;
  const cases = allVisaCases({ status: selectedStatus });
  const allRows = selectedStatus ? allVisaCases() : cases;
  const clients = listClients();
  const clientIdsWithCase = new Set(allRows.map((visaCase) => visaCase.client_id));
  const availableClients = clients.filter((client) => !clientIdsWithCase.has(client.id));
  const statusCount = (value: string) => allRows.filter((visaCase) => visaCase.status === value).length;
  const needsDocuments = allRows.filter((visaCase) => visaCase.document_open > 0).length;
  const withAppointment = allRows.filter((visaCase) => !!visaCase.appointment_at).length;
  const approved = statusCount("approved");

  const pills = [
    { value: "", label: t("all"), count: allRows.length, active: !selectedStatus, href: "/visa" },
    ...VISA_STATUSES.map((value) => ({
      value,
      label: t(`visa.${value}`),
      count: statusCount(value),
      active: selectedStatus === value,
      href: `/visa?status=${value}`,
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
          { label: t("visaCase"), value: allRows.length, tone: "accent" },
          { label: t("attentionRequired"), value: needsDocuments, tone: needsDocuments ? "danger" : "ok" },
          { label: t("appointment"), value: withAppointment, tone: "info" },
          { label: t("visa.approved"), value: approved, tone: "ok" },
        ]}
      />

      <details className="rounded-card border border-border bg-surface shadow-evo">
        <summary className="cursor-pointer list-none px-5 py-4 text-[13.5px] font-semibold text-fg marker:hidden">
          <span className="inline-flex items-center gap-2 text-accent">
            <span aria-hidden="true">＋</span>
            {t("addVisaCase")}
          </span>
        </summary>
        <form action={upsertVisaCaseAction} className="grid gap-3 border-t border-border px-5 py-4 sm:grid-cols-2 xl:grid-cols-5">
          <div className="sm:col-span-2 xl:col-span-1">
            <label htmlFor="visa-client" className={labelCls}>{t("client")}</label>
            <select id="visa-client" name="client_id" required className={inputCls}>
              <option value="">{t("client")}</option>
              {availableClients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="visa-country" className={labelCls}>{t("country")}</label>
            <input id="visa-country" name="country" className={inputCls} />
          </div>
          <div>
            <label htmlFor="visa-status" className={labelCls}>{t("status")}</label>
            <select id="visa-status" name="status" defaultValue="not_started" className={inputCls}>
              {VISA_STATUSES.map((value) => (
                <option key={value} value={value}>{t(`visa.${value}`)}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="visa-appointment" className={labelCls}>{t("appointment")}</label>
            <input id="visa-appointment" name="appointment_at" type="datetime-local" className={inputCls} />
          </div>
          <div className="sm:col-span-2 xl:col-span-1">
            <label htmlFor="visa-notes" className={labelCls}>{t("notes")}</label>
            <input id="visa-notes" name="notes" className={inputCls} />
          </div>
          <button type="submit" className={cn(btnCls, "sm:col-span-2 xl:col-span-5 xl:w-fit")}>
            {t("add")}
          </button>
        </form>
      </details>

      <nav aria-label={t("visaQueue")} className="flex flex-wrap gap-2">
        {pills.map((pill) => (
          <Link
            key={pill.value || "all"}
            href={pill.href}
            aria-current={pill.active ? "page" : undefined}
            className={cn(
              "inline-flex min-h-10 items-center gap-2 rounded-full px-3 text-[12.5px] font-medium",
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

      {cases.length === 0 ? (
        <Card>
          <EmptyState text={t("noResults")} />
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {cases.map((visaCase) => (
            <article key={visaCase.id} className="rounded-card border border-border bg-surface p-5 shadow-evo">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <Link href={`/visa/${visaCase.id}`} className="text-[15px] font-bold text-fg hover:text-accent">
                    {visaCase.client_name}
                  </Link>
                  <p className="mt-1 text-[12px] text-fg-3">
                    {[visaCase.country, visaCase.manager_name, visaCase.curator_name].filter(Boolean).join(" · ") || "—"}
                  </p>
                </div>
                <Badge value={visaCase.status} label={t(`visa.${visaCase.status}`)} />
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3 rounded-nav bg-surface-2 p-3 text-[12px] sm:grid-cols-4">
                <div>
                  <dt className="text-fg-3">{t("documents")}</dt>
                  <dd className="mt-1 font-mono font-semibold text-fg">
                    {visaCase.document_total - visaCase.document_open}/{visaCase.document_total}
                  </dd>
                </div>
                <div>
                  <dt className="text-fg-3">{t("applications")}</dt>
                  <dd className="mt-1 font-mono font-semibold text-fg">{visaCase.active_applications}</dd>
                </div>
                <div>
                  <dt className="text-fg-3">{t("openTasks")}</dt>
                  <dd className="mt-1 font-mono font-semibold text-fg">{visaCase.open_tasks}</dd>
                </div>
                <div>
                  <dt className="text-fg-3">{t("appointment")}</dt>
                  <dd className="mt-1 font-mono font-semibold text-fg">{visaCase.appointment_at ?? "—"}</dd>
                </div>
              </dl>
              {visaCase.notes && <p className="mt-3 text-[12.5px] leading-5 text-fg-2">{visaCase.notes}</p>}
              <div className="mt-4 border-t border-border pt-3">
                <VisaStatusForm visaCase={visaCase} t={t} />
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
