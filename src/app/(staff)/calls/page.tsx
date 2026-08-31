import Link from "next/link";

import { Icon } from "@/components/icons";
import {
  ContextBanner,
  QueueMetrics,
  WorkflowStepper,
} from "@/components/platform/operations/OperationsPrimitives";
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  btnCls,
  btnGhostCls,
  cn,
  inputCls,
} from "@/components/ui";
import { getIntegrationStatus, logCallAction } from "@/lib/actions";
import { requireStaffRoute } from "@/lib/guards";
import { getT } from "@/lib/i18n";
import { listCalls, listLeadsForActor } from "@/lib/queries";

function fmtDuration(seconds: number): string {
  if (!seconds) return "—";
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

export default async function CallsPage({
  searchParams,
}: {
  searchParams: Promise<{ direction?: string; status?: string }>;
}) {
  const [{ t }, params] = await Promise.all([getT(), searchParams]);
  const user = await requireStaffRoute("/calls");
  const allCalls = listCalls();
  const leads = listLeadsForActor(user);
  const integrations = await getIntegrationStatus();
  const direction = params.direction === "in" || params.direction === "out" ? params.direction : "";
  const status = ["answered", "missed", "busy"].includes(params.status ?? "") ? params.status ?? "" : "";
  const calls = allCalls.filter(
    (call) =>
      (!direction || call.direction === direction) &&
      (!status || call.status === status),
  );
  const incomingCount = allCalls.filter((call) => call.direction === "in").length;
  const outgoingCount = allCalls.filter((call) => call.direction === "out").length;
  const missedCount = allCalls.filter((call) => call.status === "missed").length;
  const answeredCount = allCalls.filter((call) => call.status === "answered").length;

  return (
    <div className="space-y-5" data-testid="calls-page">
      <PageHeader
        title={t("callsWorkflow")}
        description={t("callsWorkflowHint")}
        action={
          <Link href="#add" className={btnCls}>
            <Icon name="plus" size={16} />
            {t("manualInteractionLog")}
          </Link>
        }
      />

      <ContextBanner
        title={
          integrations.telephony
            ? t("configuredNotVerified")
            : t("statusNotConfigured")
        }
        description={
          integrations.telephony
            ? t("telephonyConfiguredNotVerified")
            : t("telephonyUnavailable")
        }
        tone="warning"
        action={user.role === "admin" ? (
          <Link href="/settings?tab=integrations#telephony" className={btnGhostCls}>
            {t("adminIntegrations")}
          </Link>
        ) : undefined}
      />

      <WorkflowStepper
        label={t("callsWorkflow")}
        current="plan"
        steps={[
          { value: "plan", label: t("callStepPlan") },
          { value: "contact", label: t("callStepContact") },
          { value: "record", label: t("callStepRecord") },
        ]}
      />

      <QueueMetrics
        items={[
          { label: t("incoming"), value: incomingCount, tone: "info" },
          { label: t("outgoing"), value: outgoingCount, tone: "accent" },
          { label: t("call.missed"), value: missedCount, tone: "danger" },
          { label: t("call.answered"), value: answeredCount, tone: "ok" },
        ]}
      />

      <section className="grid gap-3 rounded-card border border-border bg-surface p-4 shadow-evo lg:grid-cols-[1fr_auto] lg:items-center">
        <div>
          <h2 className="text-base font-bold text-fg">{t("taskMeetingJourney")}</h2>
          <p className="mt-1 text-sm leading-5 text-fg-3">
            {t("meetingSupportUnavailable")} {t("taskMeetingJourneyHint")}
          </p>
        </div>
        <Link href="/tasks?view=calendar" className={btnGhostCls}>
          <Icon name="calendar" size={16} />
          {t("planNextContact")}
        </Link>
      </section>

      <details id="add" className="scroll-mt-24 rounded-card border border-border bg-surface shadow-evo">
        <summary className="cursor-pointer list-none px-5 py-4 text-base font-bold text-fg">
          <span className="inline-flex items-center gap-2">
            <Icon name="phone" size={16} />
            {t("manualInteractionLog")}
          </span>
        </summary>
        <div className="border-t border-border p-4">
          <p className="mb-3 text-xs leading-5 text-fg-3">{t("manualInteractionHint")}</p>
          <form action={logCallAction} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <input name="phone" required placeholder={t("phone")} className={inputCls} />
            <select name="direction" aria-label={t("direction")} className={inputCls}>
              <option value="out">{t("call.out")}</option>
              <option value="in">{t("call.in")}</option>
            </select>
            <select name="status" aria-label={t("status")} className={inputCls}>
              <option value="answered">{t("call.answered")}</option>
              <option value="missed">{t("call.missed")}</option>
              <option value="busy">{t("call.busy")}</option>
            </select>
            <input
              name="duration_sec"
              type="number"
              min="0"
              placeholder={`${t("duration")} (${t("secondsShort")})`}
              className={inputCls}
            />
            <select name="lead_id" aria-label={t("linkedLead")} className={inputCls}>
              <option value="">{t("linkedLead")}: —</option>
              {leads.map((lead) => (
                <option key={lead.id} value={lead.id}>
                  {lead.name}
                </option>
              ))}
            </select>
            <input name="notes" placeholder={t("callOutcome")} className={inputCls} />
            <button type="submit" className={btnCls}>
              {t("add")}
            </button>
          </form>
        </div>
      </details>

      <section aria-labelledby="call-journal-title" className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 id="call-journal-title" className="text-md font-bold text-fg">
            {t("callJournal")}
          </h2>
          <form className="grid grid-cols-2 gap-2 sm:flex">
            <select
              name="direction"
              defaultValue={direction}
              aria-label={t("direction")}
              className={cn(inputCls, "h-10")}
            >
              <option value="">{t("allDirections")}</option>
              <option value="in">{t("call.in")}</option>
              <option value="out">{t("call.out")}</option>
            </select>
            <select
              name="status"
              defaultValue={status}
              aria-label={t("status")}
              className={cn(inputCls, "h-10")}
            >
              <option value="">{t("allStatuses")}</option>
              <option value="answered">{t("call.answered")}</option>
              <option value="missed">{t("call.missed")}</option>
              <option value="busy">{t("call.busy")}</option>
            </select>
            <button type="submit" className={cn(btnGhostCls, "col-span-2 h-10")}>
              {t("search")}
            </button>
          </form>
        </div>

        <div className="grid gap-2 md:hidden">
          {calls.map((call) => {
            const incoming = call.direction === "in";
            return (
              <article key={call.id} className="rounded-card border border-border bg-surface p-4 shadow-evo">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
                        incoming ? "bg-info-weak text-info" : "bg-surface-2 text-fg-2",
                      )}
                    >
                      <Icon name={incoming ? "call-in" : "call-out"} size={13} />
                      {incoming ? t("call.in") : t("call.out")}
                    </span>
                    <div className="mt-2 font-mono text-base font-semibold text-fg">{call.phone}</div>
                  </div>
                  <Badge value={call.status} label={t(`call.${call.status}`)} />
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-2 border-t border-border pt-3 text-xs">
                  <div>
                    <dt className="text-fg-3">{t("linkedLead")}</dt>
                    <dd className="mt-0.5 text-fg">
                      {call.lead_id ? (
                        <Link href={`/sales/${call.lead_id}`} className="text-accent">
                          {call.lead_name}
                        </Link>
                      ) : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-fg-3">{t("duration")}</dt>
                    <dd className="mt-0.5 font-mono text-fg">{fmtDuration(call.duration_sec)}</dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-fg-3">{t("createdAt")}</dt>
                    <dd className="mt-0.5 font-mono text-fg">{call.started_at}</dd>
                  </div>
                  {call.notes && (
                    <div className="col-span-2">
                      <dt className="text-fg-3">{t("callOutcome")}</dt>
                      <dd className="mt-0.5 break-words text-fg">{call.notes}</dd>
                    </div>
                  )}
                </dl>
              </article>
            );
          })}
          {calls.length === 0 && (
            <div className="rounded-card border border-border bg-surface">
              <EmptyState text={t("noResults")} />
            </div>
          )}
        </div>

        <Card bodyClassName="hidden px-0 py-0 md:block">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-surface-2 text-xs uppercase tracking-[0.04em] text-fg-3">
                <tr>
                  <th className="px-5 py-3 font-semibold">{t("direction")}</th>
                  <th className="px-4 py-3 font-semibold">{t("phone")}</th>
                  <th className="px-4 py-3 font-semibold">{t("linkedLead")}</th>
                  <th className="px-4 py-3 font-semibold">{t("manager")}</th>
                  <th className="px-4 py-3 font-semibold">{t("status")}</th>
                  <th className="px-4 py-3 text-right font-semibold">{t("duration")}</th>
                  <th className="px-4 py-3 font-semibold">{t("createdAt")}</th>
                  <th className="px-5 py-3 font-semibold">{t("recording")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {calls.map((call) => {
                  const incoming = call.direction === "in";
                  return (
                    <tr key={call.id} className="hover:bg-surface-2">
                      <td className="px-5 py-3">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold",
                            incoming ? "bg-info-weak text-info" : "bg-surface-2 text-fg-2",
                          )}
                        >
                          <Icon name={incoming ? "call-in" : "call-out"} size={13} />
                          {incoming ? t("call.in") : t("call.out")}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-sm text-fg">{call.phone}</td>
                      <td className="px-4 py-3">
                        {call.lead_id ? (
                          <Link href={`/sales/${call.lead_id}`} className="text-accent hover:underline">
                            {call.lead_name}
                          </Link>
                        ) : "—"}
                      </td>
                      <td className="px-4 py-3 text-fg-2">{call.manager_name ?? "—"}</td>
                      <td className="px-4 py-3">
                        <Badge value={call.status} label={t(`call.${call.status}`)} />
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-sm text-fg-2">
                        {fmtDuration(call.duration_sec)}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-fg-3">
                        {call.started_at}
                      </td>
                      <td className="px-5 py-3">
                        {call.recording_url ? (
                          <a
                            href={call.recording_url}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={t("recording")}
                            className="inline-grid h-8 w-8 place-items-center rounded-nav text-accent hover:bg-accent-weak"
                          >
                            <Icon name="play" size={14} />
                          </a>
                        ) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {calls.length === 0 && (
            <div className="px-5 py-4">
              <EmptyState text={t("noResults")} />
            </div>
          )}
        </Card>
      </section>
    </div>
  );
}
