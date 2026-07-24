import Link from "next/link";
import { getT } from "@/lib/i18n";
import { listClients, type ClientRow } from "@/lib/queries";
import { STAGES } from "@/lib/db";
import { createClientAction } from "@/lib/actions";
import { requireStaffRoute } from "@/lib/guards";
import { Badge, EmptyState, PageHeader, inputCls, btnCls, cn } from "@/components/ui";
import { Icon } from "@/components/icons";
import { StudentProgress } from "@/components/platform/core/StudentProgress";

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
}

function riskPresentation(client: ClientRow, t: (key: string) => string) {
  const signals = [
    client.overdue_tasks > 0 ? `${t("overdueTasks")}: ${client.overdue_tasks}` : null,
    client.overdue_payments > 0 ? `${t("overduePayments")}: ${client.overdue_payments}` : null,
    client.rejected_documents > 0 ? `${t("doc.rejected")}: ${client.rejected_documents}` : null,
  ].filter(Boolean) as string[];
  const ownerMissing = !client.manager_name && !client.curator_name;

  if (signals.length > 0) {
    return { label: signals.join(" · "), tone: "danger" as const };
  }
  if (ownerMissing) {
    return { label: t("notAssigned"), tone: "warning" as const };
  }
  return { label: t("studentRiskNotRecorded"), tone: "neutral" as const };
}

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string; q?: string }>;
}) {
  await requireStaffRoute("/clients");
  const { t } = await getT();
  const { stage, q } = await searchParams;
  const clients = listClients({ stage, q });
  const qs = (s?: string) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (s) p.set("stage", s);
    const str = p.toString();
    return str ? `/clients?${str}` : "/clients";
  };
  const pillBase = "inline-flex min-h-9 items-center rounded-full px-3 text-[12.5px] font-medium transition-[background-color,color] duration-150";
  const stageItems = STAGES.map((stageItem) => ({ key: stageItem, label: t(`stage.${stageItem}`) }));

  return (
    <div className="space-y-5">
      <PageHeader title={t("student360")} description={t("student360Hint")} />

      <section
        aria-labelledby="student-source-title"
        className="flex items-start gap-3 rounded-card border border-info/20 bg-info-weak px-4 py-3.5 text-info"
      >
        <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden="true" />
        <div>
          <h2 id="student-source-title" className="text-[12px] font-bold uppercase tracking-[0.06em]">
            {t("operationalContext")}
          </h2>
          <p className="mt-1 max-w-4xl text-[12.5px] leading-5 text-fg-2">{t("studentRecordSourceHint")}</p>
        </div>
      </section>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <form className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1 sm:max-w-sm">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-3"><Icon name="search" size={16} /></span>
            <input name="q" defaultValue={q} placeholder={t("search")} className={cn(inputCls, "pl-9")} />
            {stage && <input type="hidden" name="stage" value={stage} />}
          </div>
          <button type="submit" className={cn(btnCls, "sm:w-auto")}>{t("search")}</button>
        </form>
        <details id="add" className="group relative w-full scroll-mt-24 lg:w-auto">
          <summary className={cn(btnCls, "w-full cursor-pointer list-none lg:w-auto")}>
            <Icon name="plus" size={16} /> {t("addClient")}
          </summary>
          <form
            action={createClientAction}
            className="mt-3 grid w-full gap-2.5 rounded-card border border-border bg-surface p-4 shadow-evo-lg sm:grid-cols-2 lg:absolute lg:right-0 lg:z-20 lg:w-[420px]"
          >
            <input name="name" required placeholder={t("name")} className={inputCls} />
            <input name="email" type="email" required placeholder={t("email")} className={inputCls} />
            <input name="phone" placeholder={t("phone")} className={inputCls} />
            <input name="target_country" placeholder={t("country")} className={inputCls} />
            <input name="target_degree" placeholder={t("degree")} className={inputCls} />
            <input name="source" placeholder={t("source")} className={inputCls} />
            <button type="submit" className={cn(btnCls, "w-full sm:col-span-2")}>{t("add")}</button>
          </form>
        </details>
      </div>

      <nav aria-label={t("stage")} className="overflow-x-auto pb-1">
        <div className="flex min-w-max gap-2">
          <Link href={qs()} aria-current={!stage ? "page" : undefined} className={cn(pillBase, !stage ? "bg-accent text-on-accent" : "bg-surface-2 text-fg-2 hover:text-fg")}>
            {t("allStages")}
          </Link>
          {STAGES.map((s) => (
            <Link key={s} href={qs(s)} aria-current={stage === s ? "page" : undefined} className={cn(pillBase, stage === s ? "bg-accent text-on-accent" : "bg-surface-2 text-fg-2 hover:text-fg")}>
              {t(`stage.${s}`)}
            </Link>
          ))}
        </div>
      </nav>

      <div className="hidden overflow-x-auto rounded-card border border-border bg-surface shadow-evo xl:block">
        <table className="w-full text-left text-[13px]">
          <thead className="border-b border-border bg-surface-2 text-[11px] uppercase tracking-[0.04em] text-fg-3">
            <tr>
              <th className="px-5 py-3 font-semibold">{t("client")}</th>
              <th className="px-4 py-3 font-semibold">{t("stage")}</th>
              <th className="px-4 py-3 font-semibold">{t("country")}</th>
              <th className="px-4 py-3 font-semibold">{t("portalTeam")}</th>
              <th className="min-w-[180px] px-4 py-3 font-semibold">{t("portalProgress")}</th>
              <th className="px-4 py-3 font-semibold">{t("risk")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {clients.map((c) => {
              const risk = riskPresentation(c, t);
              return (
                <tr key={c.id} className="transition-[background-color] hover:bg-surface-2">
                <td className="px-5 py-3">
                  <Link href={`/clients/${c.id}`} className="flex items-center gap-3">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent-weak text-[11px] font-semibold text-accent">
                      {initials(c.name)}
                    </span>
                    <span className="min-w-0">
                      <span className="block font-semibold text-fg hover:text-accent">{c.name}</span>
                      <span className="block truncate text-[12px] text-fg-3">{c.email}</span>
                    </span>
                  </Link>
                </td>
                <td className="px-4 py-3"><Badge value={c.stage} label={t(`stage.${c.stage}`)} /></td>
                <td className="px-4 py-3 text-fg-2">
                  {[c.target_country, c.target_degree].filter(Boolean).join(" · ") || "—"}
                </td>
                <td className="px-4 py-3 text-fg-2">
                  <span className="block">{c.manager_name ?? "—"}</span>
                  <span className="mt-0.5 block text-[11.5px] text-fg-3">{c.curator_name ?? "—"}</span>
                </td>
                <td className="px-4 py-3">
                  <StudentProgress
                    compact
                    stages={stageItems}
                    currentStage={c.stage}
                    currentLabel={t(`stage.${c.stage}`)}
                    label={`${t("portalProgress")}: ${c.name}`}
                  />
                </td>
                <td className="px-4 py-3">
                  <span className={cn(
                    "inline-flex max-w-[180px] items-center rounded-full px-2.5 py-1 text-[11px] font-semibold",
                    risk.tone === "danger"
                      ? "bg-danger-weak text-danger"
                      : risk.tone === "warning"
                        ? "bg-warn-weak text-warn"
                        : "bg-surface-2 text-fg-3",
                  )}>
                    {risk.label}
                  </span>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
        {clients.length === 0 && <EmptyState text={t("noResults")} />}
      </div>

      <div className="grid gap-3 xl:hidden">
        {clients.map((c) => {
          const risk = riskPresentation(c, t);
          return (
            <article key={c.id} className="min-w-0 rounded-card border border-border bg-surface p-4 shadow-evo">
              <div className="flex min-w-0 items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-ctl bg-accent-weak text-[12px] font-bold text-accent">
                  {initials(c.name)}
                </span>
                <div className="min-w-0 flex-1">
                  <Link href={`/clients/${c.id}`} className="block truncate text-[14px] font-bold text-fg hover:text-accent">
                    {c.name}
                  </Link>
                  <p className="mt-0.5 truncate text-[12px] text-fg-3">
                    {[c.target_country, c.target_degree].filter(Boolean).join(" · ") || c.email}
                  </p>
                </div>
                <Badge value={c.stage} label={t(`stage.${c.stage}`)} />
              </div>

              <div className="mt-4">
                <StudentProgress
                  compact
                  stages={stageItems}
                  currentStage={c.stage}
                  currentLabel={t(`stage.${c.stage}`)}
                  label={`${t("portalProgress")}: ${c.name}`}
                />
              </div>

              <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-3 text-[12px]">
                <div className="min-w-0">
                  <dt className="text-fg-3">{t("manager")}</dt>
                  <dd className="mt-1 truncate font-medium text-fg-2">{c.manager_name ?? "—"}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-fg-3">{t("curator")}</dt>
                  <dd className="mt-1 truncate font-medium text-fg-2">{c.curator_name ?? "—"}</dd>
                </div>
              </dl>

              <div className={cn(
                "mt-3 flex items-center justify-between gap-3 rounded-ctl px-3 py-2 text-[11.5px]",
                risk.tone === "danger"
                  ? "bg-danger-weak text-danger"
                  : risk.tone === "warning"
                    ? "bg-warn-weak text-warn"
                    : "bg-surface-2 text-fg-3",
              )}>
                <span className="font-semibold">{t("risk")}</span>
                <span className="text-right">{risk.label}</span>
              </div>
            </article>
          );
        })}
        {clients.length === 0 && (
          <div className="rounded-card border border-border bg-surface">
            <EmptyState text={t("noResults")} />
          </div>
        )}
      </div>
    </div>
  );
}
