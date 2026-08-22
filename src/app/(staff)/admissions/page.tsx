import Link from "next/link";

import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import {
  buildAdmissionsOverview,
  type AdmissionsCountryGroup,
} from "@/lib/platform-admissions-overview";
import {
  admissionsCuratorOptions,
  admissionsFilterQuery,
  filterAdmissionsCases,
  parseAdmissionsFilter,
} from "@/lib/platform-admissions-filters";
import { AdmissionsFilterBar } from "./AdmissionsFilterBar";
import { ADMISSIONS_STEP_LABELS, loadAdmissionsCases } from "./admissions-data";

function CountryCard({
  group,
  query,
}: {
  group: AdmissionsCountryGroup;
  query: string;
}) {
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-[15px] font-bold text-fg">{group.country}</h2>
        <Badge value="total" label={`дел: ${group.totalCases}`} />
        {group.attentionCount > 0 ? (
          <Badge value="blocked" label={`требуют внимания: ${group.attentionCount}`} />
        ) : null}
      </div>

      <ul className="grid gap-2 md:grid-cols-5">
        {group.steps.map((step) => (
          <li
            key={step.step}
            className="rounded-lg border border-border p-3"
          >
            <p className="text-[12px] text-muted">{ADMISSIONS_STEP_LABELS[step.step]}</p>
            <p className="text-[20px] font-bold text-fg">{step.cases.length}</p>
            {step.attentionCount > 0 ? (
              <p className="text-[12px] text-muted">
                из них с просрочкой: {step.attentionCount}
              </p>
            ) : null}
          </li>
        ))}
      </ul>

      {group.beforeDeliveryCount > 0 ||
      group.unknownStageCount > 0 ||
      group.closedCount > 0 ? (
        <p className="mt-3 text-[12px] text-muted">
          Вне воронки:
          {group.beforeDeliveryCount > 0
            ? ` до начала работы ${group.beforeDeliveryCount};`
            : ""}
          {group.closedCount > 0 ? ` закрыто ${group.closedCount};` : ""}
          {group.unknownStageCount > 0
            ? ` этап не распознан ${group.unknownStageCount}`
            : ""}
        </p>
      ) : null}

      <p className="mt-3">
        <Link
          className="text-[13px] text-accent underline"
          href={`/admissions/${encodeURIComponent(group.country)}${query}`}
        >
          Открыть воронку страны
        </Link>
      </p>
    </Card>
  );
}

export default async function AdmissionsOverviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const filter = parseAdmissionsFilter(params);
  const allCases = await loadAdmissionsCases();
  const cases = filterAdmissionsCases(allCases, filter);
  const overview = buildAdmissionsOverview(cases);
  const query = admissionsFilterQuery(filter);

  return (
    <div className="grid gap-5">
      <PageHeader
        title="Поступление по странам"
        description="Дела студентов после договора, сгруппированные по стране и шагу работы."
      />

      <AdmissionsFilterBar
        action="/admissions"
        filter={filter}
        curatorOptions={admissionsCuratorOptions(allCases)}
        matchedCount={cases.length}
        totalCount={allCases.length}
      />

      {overview.unknownStageCount > 0 ? (
        <Card>
          <p className="text-[13px] text-fg">
            {overview.unknownStageCount} дел находятся на этапе, которого нет в
            этой воронке. Они посчитаны отдельно и не отнесены к ближайшему шагу:
            последовательность этапов задаётся версией рабочего контракта и могла
            измениться.
          </p>
        </Card>
      ) : null}

      {overview.countries.length === 0 ? (
        <Card>
          <EmptyState text="Дел студентов после договора пока нет." />
        </Card>
      ) : (
        overview.countries.map((group) => (
          <CountryCard key={group.country} group={group} query={query} />
        ))
      )}
    </div>
  );
}
