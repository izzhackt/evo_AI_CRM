import { randomUUID } from "node:crypto";

import {
  approvePlatformContractTemplateVersionAction,
  createPlatformContractTemplateVersionAction,
  generatePlatformPostContractReportAction,
  generatePlatformStudentCaseContractDraftAction,
  retirePlatformContractTemplateVersionAction,
  reviewPlatformPostContractReportAction,
  reviewPlatformStudentCaseContractDraftAction,
  seedPlatformPostContractItemsAction,
  updatePlatformPostContractItemAction,
} from "@/lib/platform-contract-actions";
import type { PlatformContractMutationOutcome } from "@/lib/platform-contract-workflow";
import type { PlatformStudentCaseHandoffContext } from "@/lib/platform-student-handoff";
import { dayInOrganizationTimezone } from "@/lib/platform-task-deadline";
import { caseMoneyWords, caseStatus, salesStage, source as sourceWord, taskStatus } from "@/lib/v3/wording";

import { StatusChip } from "../blocks/StatusChip";
import { CaseMoneyPanel } from "./CaseMoney";
import { CASE_MONEY_PANEL } from "./case-money-view";
import { caseMomentLabel } from "./case-work-view";
import {
  ContractDraftReportWorkspace,
  type ContractDraftReportActions,
  type ContractDraftReportRequestIdFor,
} from "./ContractDraftReportWorkspace";
import { ProfileAmoCrmCommandSection } from "./ProfileAmoCrmCommandSection";
import type {
  ProfileContractRetry,
  ProfileContractSnapshot,
} from "./types";

const CONTRACT_ACTIONS: ContractDraftReportActions = {
  createTemplate: createPlatformContractTemplateVersionAction,
  approveTemplate: approvePlatformContractTemplateVersionAction,
  retireTemplate: retirePlatformContractTemplateVersionAction,
  generateDraft: generatePlatformStudentCaseContractDraftAction,
  reviewDraft: reviewPlatformStudentCaseContractDraftAction,
  seedItems: seedPlatformPostContractItemsAction,
  updateItem: updatePlatformPostContractItemAction,
  generateReport: generatePlatformPostContractReportAction,
  reviewReport: reviewPlatformPostContractReportAction,
};

function buildRequestIdFactory(
  retry: ProfileContractRetry | undefined,
): ContractDraftReportRequestIdFor {
  const requestIds = new Map<string, string>();
  return (operation, subjectId) => {
    const normalizedSubjectId = subjectId ?? "";
    if (
      retry?.operation === operation &&
      (retry.subjectId ?? "") === normalizedSubjectId
    ) {
      return retry.requestId;
    }
    const key = `${operation}:${normalizedSubjectId}`;
    const current = requestIds.get(key);
    if (current) return current;
    const generated = randomUUID();
    requestIds.set(key, generated);
    return generated;
  };
}

/** «ДД.ММ ЧЧ:ММ» по Бишкеку; неверная дата — ошибка, а не пустое место. */
function formatTimestamp(value: string, today: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    throw new Error("V3 profile handoff timestamp is invalid.");
  }
  return caseMomentLabel(value, today);
}

function Fact({ label, children }: Readonly<{
  label: string;
  children: React.ReactNode;
}>) {
  return (
    <div className="min-w-0 border-b border-border py-2">
      <dt className="t-caption text-fg-2">
        {label}
      </dt>
      <dd className="mt-0.5 break-words t-body-compact text-fg">
        {children}
      </dd>
    </div>
  );
}

/**
 * Служебные сведения о передаче дела: сырые id, версии и режим передачи —
 * только в панели «Служебные сведения» вкладки, не в основной сводке.
 */
function HandoffContext({ handoff }: Readonly<{
  handoff: PlatformStudentCaseHandoffContext;
}>) {
  const exceptional = handoff.handoffMode === "exceptional_override";
  const modeLabel = exceptional ? "Исключение Admin" : handoff.handoffMode === "sales_report" ? "Из отчёта продаж" : "Обычная передача";
  // Ключ из базы на экран не попадает: неизвестный этап или источник не называется.
  const salesContext = [salesStage(handoff.salesContext.stageKey), sourceWord(handoff.salesContext.sourceKey)]
    .filter(Boolean).join(" · ");
  const today = dayInOrganizationTimezone(new Date());

  return (
    <section
      data-testid="canonical-student-case-handoff"
      data-handoff-mode={handoff.handoffMode}
      aria-labelledby="money-service-handoff"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h4 id="money-service-handoff" className="t-item text-fg">Передача в поступление</h4>
        <StatusChip label={modeLabel} tone={exceptional ? "warn" : "neutral"} />
      </div>
      <dl className="mt-1 grid gap-x-6 @xl:grid-cols-2">
        {caseStatus(handoff.caseState) ? <Fact label="Состояние дела">{caseStatus(handoff.caseState)}</Fact> : null}
        <Fact label="Ответственный в поступлении">
          {handoff.admissionsOwnerDisplayName}
        </Fact>
        <Fact label="Передано">
          <time dateTime={handoff.handedOffAt} className="font-mono tabular-nums">{formatTimestamp(handoff.handedOffAt, today)}</time> · {handoff.actorDisplayName}
        </Fact>
        {salesContext ? <Fact label="Продажа: этап · источник">{salesContext}</Fact> : null}
        <Fact label="ID дела">
          <span className="font-mono t-meta">{handoff.studentCaseId}</span>
        </Fact>
        <Fact label="ID лида">
          <span className="font-mono t-meta">{handoff.leadId}</span>
        </Fact>
        <Fact label="ID клиента">
          <span className="font-mono t-meta">
            {handoff.clientContext.clientId}
          </span>
        </Fact>
        <Fact label="Версии записей">
          <span className="font-mono t-meta">передача {handoff.gateVersion} · процесс {handoff.workflowVersion}</span>
        </Fact>
      </dl>
      <div className="border-b border-border py-2">
        <p className="t-caption text-fg-2">
          Причина передачи
        </p>
        <p
          className="mt-0.5 t-body-compact text-fg"
          data-testid={exceptional ? "canonical-handoff-override-reason" : undefined}
        >
          {handoff.handoffReason}
        </p>
      </div>
      <div className="py-2">
        <p className="t-caption text-fg-2">
          Стартовые задачи
        </p>
        {handoff.starterTasks.length === 0 ? (
          <p className="mt-1 t-body-compact text-fg-2">Стартовых задач нет.</p>
        ) : (
          <ul className="mt-1 border-t border-border">
            {handoff.starterTasks.map((task) => (
              <li
                key={task.taskId}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border py-2"
                data-testid="v3-profile-handoff-starter-task"
              >
                <span className="min-w-0 flex-1 t-body-compact text-fg">
                  {task.title}
                </span>
                <span className="t-meta text-fg-2">{task.assigneeDisplayName}</span>
                <StatusChip label={taskStatus(task.status) ?? ""} tone={task.status === "done" ? "ok" : "neutral"} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/**
 * Раздел договора дела во вкладке «Договор и оплата» (Э8.3): две панели «⋯»
 * листа — «Подготовка договора по шаблону» и «Служебные сведения»
 * (передача дела и команда amoCRM). У роли продаж раздела нет, как раньше.
 */
export function ProfileContractWorkspace({
  snapshot,
  actor,
  organizationId,
  result,
  retry,
}: Readonly<{
  snapshot: ProfileContractSnapshot;
  actor: import("@/lib/platform-auth").ActivePlatformActor;
  organizationId: string;
  result?: PlatformContractMutationOutcome;
  retry?: ProfileContractRetry;
}>) {
  if (actor.presentationRole === "sales") return null;
  if (
    snapshot.workspace.organizationId !== organizationId ||
    (snapshot.handoff !== null && (
      snapshot.handoff.organizationId !== organizationId ||
      snapshot.workspace.studentCaseId !== snapshot.handoff.studentCaseId
    ))
  ) {
    throw new Error("V3 contract workspace identity does not match the active case.");
  }

  return (
    <>
      <CaseMoneyPanel id={CASE_MONEY_PANEL.contract} label={caseMoneyWords.panels.contract}>
        <ContractDraftReportWorkspace
          workspace={snapshot.workspace}
          actions={CONTRACT_ACTIONS}
          requestIdFor={buildRequestIdFactory(retry)}
          result={result}
          retrySubjectId={retry?.subjectId}
        />
      </CaseMoneyPanel>
      {snapshot.handoff ? (
        <CaseMoneyPanel id={CASE_MONEY_PANEL.service} label={caseMoneyWords.panels.service}>
          <div className="space-y-4">
            <HandoffContext handoff={snapshot.handoff} />
            <ProfileAmoCrmCommandSection
              organizationId={organizationId}
              actor={actor}
              handoff={snapshot.handoff}
            />
          </div>
        </CaseMoneyPanel>
      ) : null}
    </>
  );
}
