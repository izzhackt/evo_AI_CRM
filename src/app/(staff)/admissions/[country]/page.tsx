import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import {
  buildAdmissionsOverview,
  type AdmissionsStepGroup,
} from "@/lib/platform-admissions-overview";
import {
  ADMISSIONS_STEP_LABELS,
  loadAdmissionsCases,
} from "../admissions-data";

function StepSection({ group }: { group: AdmissionsStepGroup }) {
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-[15px] font-bold text-fg">
          {ADMISSIONS_STEP_LABELS[group.step]}
        </h2>
        <Badge value="total" label={`студентов: ${group.cases.length}`} />
        {group.attentionCount > 0 ? (
          <Badge value="blocked" label={`с просрочкой: ${group.attentionCount}`} />
        ) : null}
      </div>

      {group.cases.length === 0 ? (
        <EmptyState text="На этом шаге сейчас никого нет." />
      ) : (
        <ul role="list" className="grid">
          {group.cases.map((item) => (
            <li
              key={item.studentCaseId}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border py-3"
            >
              <Link
                className="text-[14px] font-semibold text-fg hover:text-accent"
                href={`/clients/${item.studentCaseId}`}
              >
                {item.studentDisplayName}
              </Link>
              <span className="text-[12px] text-muted">
                куратор: {item.curatorDisplayName ?? "не назначен"}
              </span>
              {item.intake ? (
                <span className="text-[12px] text-muted">набор: {item.intake}</span>
              ) : null}
              {item.overdueTaskCount > 0 ? (
                <Badge value="blocked" label={`просроченных задач: ${item.overdueTaskCount}`} />
              ) : null}
              {item.overdueObligationCount > 0 ? (
                <Badge value="blocked" label={`просроченных платежей: ${item.overdueObligationCount}`} />
              ) : null}
              {item.rejectedDocumentCount > 0 ? (
                <Badge value="blocked" label={`документов на переделку: ${item.rejectedDocumentCount}`} />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default async function AdmissionsCountryPage({
  params,
}: {
  params: Promise<{ country: string }>;
}) {
  const { country } = await params;
  const requested = decodeURIComponent(country).trim();
  const overview = buildAdmissionsOverview(await loadAdmissionsCases());
  const group = overview.countries.find((item) => item.country === requested);

  // An unknown country is a missing page rather than an empty funnel, so a
  // mistyped link cannot look like a country with no students.
  if (!group) notFound();

  return (
    <div className="grid gap-5">
      <PageHeader
        title={group.country}
        description="Дела студентов после договора по шагам работы. Нажмите на имя, чтобы открыть дело."
      />

      <p className="text-[13px] text-muted">
        <Link className="text-accent underline" href="/admissions">
          ← Все страны
        </Link>
      </p>

      {group.unknownStageCount > 0 || group.beforeDeliveryCount > 0 || group.closedCount > 0 ? (
        <Card>
          <p className="text-[13px] text-fg">
            Вне воронки:
            {group.beforeDeliveryCount > 0
              ? ` до начала работы ${group.beforeDeliveryCount};`
              : ""}
            {group.closedCount > 0 ? ` закрыто ${group.closedCount};` : ""}
            {group.unknownStageCount > 0
              ? ` этап не распознан ${group.unknownStageCount}`
              : ""}
          </p>
        </Card>
      ) : null}

      {group.steps.map((step) => (
        <StepSection key={step.step} group={step} />
      ))}
    </div>
  );
}
