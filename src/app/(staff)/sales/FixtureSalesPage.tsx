import Link from "next/link";

import { Icon } from "@/components/icons";
import { SalesBoard } from "@/components/platform/core/SalesBoard";
import {
  getSalesCopy,
  type SalesView,
} from "@/components/platform/core/SalesCopy";
import { SalesList } from "@/components/platform/core/SalesList";
import { formatSalesNumber } from "@/components/platform/core/SalesPresentation";
import { SalesQuickAdd } from "@/components/platform/core/SalesQuickAdd";
import { SalesSourceTruth } from "@/components/platform/core/SalesSourceTruth";
import { SalesViewSwitch } from "@/components/platform/core/SalesViewSwitch";
import {
  PageHeader,
  StatCard,
  btnCls,
  btnGhostCls,
  cn,
  filterBarCls,
  inputCls,
} from "@/components/ui";
import {
  isActiveLeadStatus,
  LEAD_STATUSES,
} from "@/lib/lead-stages";
import { isStaffRole } from "@/lib/domain";
import { getT } from "@/lib/i18n";
import type { StaffRole } from "@/lib/roles";

type SalesSearchParams = {
  before_at?: string | string[];
  before_id?: string | string[];
  manager?: string;
  source?: string;
  risk?: string;
  status?: string;
  view?: string;
};

type SalesLead = Parameters<typeof SalesBoard>[0]["leads"][number];
type AddLeadAction = (formData: FormData) => void | Promise<void>;

type SalesProvider = {
  role: StaffRole;
  leads: SalesLead[];
  staff: { id: number; name: string; role: string }[];
  addLeadAction?: AddLeadAction;
  fixturePipelineId: number;
};

async function loadFixtureSalesProvider(): Promise<SalesProvider> {
  const [guards, queries, actions, leadStages] = await Promise.all([
    import("@/lib/guards"),
    import("@/lib/queries"),
    import("@/lib/actions"),
    import("@/lib/lead-stages"),
  ]);
  const actor = await guards.requireStaffRoute("/sales");
  if (!isStaffRole(actor.role)) {
    throw new Error("Fixture sales route received a non-staff actor.");
  }

  return {
    role: actor.role,
    leads: queries.listLeadsForActor(actor),
    staff: queries.listStaff(),
    addLeadAction: actions.addLeadAction,
    fixturePipelineId: leadStages.EVO_AMO_PIPELINE_ID,
  };
}

function salesViewHref(
  nextView: SalesView,
  filters: Omit<SalesSearchParams, "view">,
) {
  const params = new URLSearchParams();
  if (filters.manager) params.set("manager", filters.manager);
  if (filters.source) params.set("source", filters.source);
  if (filters.risk) params.set("risk", filters.risk);
  if (filters.status) params.set("status", filters.status);
  params.set("view", nextView);
  return `/sales?${params.toString()}`;
}

export default async function FixtureSalesPage({
  searchParams,
}: {
  searchParams: Promise<SalesSearchParams>;
}) {
  const { t, locale } = await getT();
  const copy = getSalesCopy(locale);
  const params = await searchParams;

  const provider = await loadFixtureSalesProvider();
  const { manager, source, risk, status } = params;
  const view: SalesView = params.view === "list" ? "list" : "board";
  const leads = provider.leads;
  const staff = provider.staff;
  const eligibleSalesManagers = staff.filter(
    (person) => person.role === "sales",
  );
  const parsedManagerId = manager ? Number.parseInt(manager, 10) : null;
  const managerId =
    parsedManagerId !== null && Number.isFinite(parsedManagerId)
      ? parsedManagerId
      : null;
  const selectedStatus =
    status && (LEAD_STATUSES as readonly string[]).includes(status) ? status : "";
  const selectedRisk =
    risk === "no_task" || risk === "overdue" ? risk : "";
  const sources = [
    ...new Set(
      leads.map((lead) => lead.source).filter(Boolean) as string[],
    ),
  ].sort();
  const isActiveDeal = (lead: {
    client_id: number | null;
    status: string;
  }) => !lead.client_id && isActiveLeadStatus(lead.status);
  const filteredLeads = leads.filter((lead) => {
    if (managerId && lead.manager_id !== managerId) return false;
    if (source && lead.source !== source) return false;
    if (selectedStatus && lead.status !== selectedStatus) return false;
    if (
      selectedRisk === "no_task" &&
      (!isActiveDeal(lead) || lead.open_tasks > 0)
    ) {
      return false;
    }
    if (
      selectedRisk === "overdue" &&
      (!isActiveDeal(lead) || lead.overdue_tasks === 0)
    ) {
      return false;
    }
    return true;
  });

  const openLeads = leads.filter(isActiveDeal);
  const convertedLeads = leads.filter((lead) => lead.client_id);
  const pipelineAmount = openLeads.reduce(
    (sum, lead) => sum + (lead.amount ?? 0),
    0,
  );
  const signedAmount = leads
    .filter((lead) => lead.status === "contract_signed" || lead.client_id)
    .reduce((sum, lead) => sum + (lead.amount ?? 0), 0);
  const noTaskLeads = openLeads.filter(
    (lead) => lead.open_tasks === 0,
  ).length;
  const overdueLeads = openLeads.filter(
    (lead) => lead.overdue_tasks > 0,
  ).length;

  const activeFilters = {
    manager,
    source,
    risk: selectedRisk || undefined,
    status: selectedStatus || undefined,
  };
  const boardHref = salesViewHref("board", activeFilters);
  const listHref = salesViewHref("list", activeFilters);
  const clearHref = view === "list" ? "/sales?view=list" : "/sales";

  return (
    <div className="min-w-0 space-y-5">
      <PageHeader
        title={t("admissionsPipeline")}
        description={copy.overviewHint}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <SalesViewSwitch
              current={view}
              boardHref={boardHref}
              listHref={listHref}
              copy={copy}
            />
            <Link href="#add" className={btnCls}>
              <Icon name="plus" size={16} />
              {t("addLead")}
            </Link>
          </div>
        }
      />

      <SalesSourceTruth
        copy={copy}
        title={t("leadSourceTruthTitle")}
        body={t("leadReadModelHint")}
        syncLabel={t("syncNotVerified")}
      />

      <section aria-label={t("salesCockpit")}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <StatCard
            label={t("activeLeads")}
            value={formatSalesNumber(openLeads.length, locale)}
            tone="accent"
          />
          <StatCard
            label={t("convertedLeads")}
            value={formatSalesNumber(convertedLeads.length, locale)}
            tone="success"
          />
          <StatCard
            label={t("dealsWithoutTasks")}
            value={formatSalesNumber(noTaskLeads, locale)}
            tone="warning"
          />
          <StatCard
            label={t("overdueLeadTasks")}
            value={formatSalesNumber(overdueLeads, locale)}
            tone="danger"
          />
          <StatCard
            label={t("pipelineValue")}
            value={`${formatSalesNumber(pipelineAmount, locale)} KGS`}
            meta={`${t("signed")}: ${formatSalesNumber(signedAmount, locale)} KGS`}
            tone="info"
          />
        </div>
      </section>

      <form
        method="get"
        aria-label={t("search")}
        className={cn(
          filterBarCls,
          "sm:grid-cols-2 xl:grid-cols-4",
        )}
      >
        <input type="hidden" name="view" value={view} />
        <label>
          <span className="sr-only">{t("manager")}</span>
          <select
            name="manager"
            defaultValue={manager ?? ""}
            aria-label={t("manager")}
            className={inputCls}
          >
            <option value="">
              {t("manager")}: {t("all")}
            </option>
            {staff.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">{t("source")}</span>
          <select
            name="source"
            defaultValue={source ?? ""}
            aria-label={t("source")}
            className={inputCls}
          >
            <option value="">
              {t("source")}: {t("all")}
            </option>
            {sources.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">{t("status")}</span>
          <select
            name="status"
            defaultValue={selectedStatus}
            aria-label={t("status")}
            className={inputCls}
          >
            <option value="">
              {t("status")}: {t("all")}
            </option>
            {LEAD_STATUSES.map((item) => (
              <option key={item} value={item}>
                {t(`lead.${item}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">{t("risk")}</span>
          <select
            name="risk"
            defaultValue={selectedRisk}
            aria-label={t("risk")}
            className={inputCls}
          >
            <option value="">
              {t("risk")}: {t("all")}
            </option>
            <option value="no_task">{t("dealsWithoutTasks")}</option>
            <option value="overdue">{t("overdueLeadTasks")}</option>
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2 xl:col-span-4">
          <button type="submit" className={btnCls}>
            <Icon name="search" size={16} />
            {t("search")}
          </button>
          <Link href={clearHref} className={btnGhostCls}>
            {t("clearFilter")}
          </Link>
          <span className="ml-auto inline-flex min-h-9 items-center rounded-full bg-surface-2 px-3 font-mono text-[11.5px] font-medium text-fg-3">
            {`amoCRM #${provider.fixturePipelineId}`}
          </span>
        </div>
      </form>

      <SalesQuickAdd
        staff={eligibleSalesManagers}
        t={t}
        copy={copy}
        canAssignManager={provider.role === "admin"}
        action={provider.addLeadAction}
      />

      <section aria-labelledby="sales-stages-title" className="min-w-0 space-y-3">
        <header className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2
              id="sales-stages-title"
              className="text-[15px] font-semibold text-fg"
            >
              {copy.salesStages}
            </h2>
            <p className="mt-0.5 text-[12px] text-fg-3">
              {copy.filteredResult}:{" "}
              <span className="font-mono font-semibold text-fg-2">
                {formatSalesNumber(filteredLeads.length, locale)}
              </span>
            </p>
          </div>
          <span className="text-[12px] font-medium text-fg-3">
            {view === "board" ? copy.kanban : copy.list}
          </span>
        </header>

        {view === "board" ? (
          <SalesBoard
            leads={filteredLeads}
            statuses={LEAD_STATUSES}
            locale={locale}
            copy={copy}
            t={t}
          />
        ) : (
          <SalesList
            leads={filteredLeads}
            locale={locale}
            copy={copy}
            t={t}
          />
        )}
      </section>
    </div>
  );
}
