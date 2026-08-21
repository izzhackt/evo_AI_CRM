import Link from "next/link";

import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { requirePlatformAdmissionsActor } from "@/lib/platform-guards";
import { listPlatformStudentCases } from "@/lib/platform-admissions";
import { isUiContractFixtureMode } from "@/lib/runtime-mode";
import {
  buildAdmissionsOverview,
  type AdmissionsCaseInput,
  type AdmissionsCountryGroup,
  type AdmissionsStep,
} from "@/lib/platform-admissions-overview";

const STEP_LABELS: Record<AdmissionsStep, string> = {
  documents: "Сбор документов",
  applications: "Подача",
  decisions: "Ожидание оффера",
  visa: "Виза",
  enrolled: "Зачисление",
};

function CountryCard({ group }: { group: AdmissionsCountryGroup }) {
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
            <p className="text-[12px] text-muted">{STEP_LABELS[step.step]}</p>
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
          href={`/clients?country=${encodeURIComponent(group.country)}`}
        >
          Открыть студентов этой страны
        </Link>
      </p>
    </Card>
  );
}

async function loadCases(): Promise<readonly AdmissionsCaseInput[]> {
  // The fixture path exists so the surface can be reviewed without a Supabase
  // project. It reads the same legacy rows the other screens use in that mode
  // and maps them onto the same shape, so the view is never a mock of itself.
  if (isUiContractFixtureMode()) {
    const [{ requireStaffRoute }, queries] = await Promise.all([
      import("@/lib/guards"),
      import("@/lib/queries"),
    ]);
    const user = await requireStaffRoute("/admissions");
    return queries.listClientsForActor(user).map((row) => ({
      studentCaseId: String(row.id),
      studentDisplayName: row.name,
      targetCountry: row.target_country ?? "Не указана",
      operationalStage: row.stage,
      state: row.case_state === "closed" ? "closed" : "active",
      currentCuratorDisplayName: row.curator_name ?? null,
      intake: null,
      overdueTaskCount: 0,
      overdueObligationCount: 0,
      rejectedDocumentCount: 0,
    }));
  }
  const actor = await requirePlatformAdmissionsActor();
  const { cases } = await listPlatformStudentCases(actor);
  return cases;
}

export default async function AdmissionsOverviewPage() {
  const overview = buildAdmissionsOverview(await loadCases());

  return (
    <div className="grid gap-5">
      <PageHeader
        title="Поступление по странам"
        description="Дела студентов после договора, сгруппированные по стране и шагу работы."
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
          <CountryCard key={group.country} group={group} />
        ))
      )}
    </div>
  );
}
