import { randomUUID } from "node:crypto";

import { Pill } from "@/components/v3/Pill";
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
import { leadStage, source as sourceWord } from "@/lib/v3/wording";

import { Card } from "./Card";
import {
  ContractDraftReportWorkspace,
  type ContractDraftReportActions,
  type ContractDraftReportRequestIdFor,
} from "./ContractDraftReportWorkspace";
import { ProfileAmoCrmCommandSection } from "./ProfileAmoCrmCommandSection";
import type {
  ProfileActorRole,
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

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    throw new Error("V3 profile handoff timestamp is invalid.");
  }
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bishkek",
  }).format(date);
}

function Fact({ label, children }: Readonly<{
  label: string;
  children: React.ReactNode;
}>) {
  return (
    <div className="min-w-0 border-b border-border px-4 py-2.5 last:border-b-0">
      <dt className="text-2xs font-semibold uppercase tracking-wide text-fg-3">
        {label}
      </dt>
      <dd className="mt-1 break-words text-sm leading-5 text-fg">
        {children}
      </dd>
    </div>
  );
}

function HandoffContext({ handoff }: Readonly<{
  handoff: PlatformStudentCaseHandoffContext;
}>) {
  const exceptional = handoff.handoffMode === "exceptional_override";
  const modeLabel = exceptional ? "Исключение Admin" : "Обычная передача";
  const salesStage = leadStage(handoff.salesContext.stageKey)
    ?? handoff.salesContext.stageKey;
  const salesSource = sourceWord(handoff.salesContext.sourceKey)
    ?? handoff.salesContext.sourceKey;

  return (
    <Card
      title="Передача в Admissions"
      aside={<Pill tone={exceptional ? "warn" : "ok"}>{modeLabel}</Pill>}
    >
      <section
        data-testid="canonical-student-case-handoff"
        data-handoff-mode={handoff.handoffMode}
      >
        <dl className="grid @4xl:grid-cols-2">
          <Fact label="Состояние дела">{handoff.caseState}</Fact>
          <Fact label="Ответственный Admissions">
            {handoff.admissionsOwnerDisplayName}
          </Fact>
          <Fact label="Передано">
            {formatTimestamp(handoff.handedOffAt)} · {handoff.actorDisplayName}
          </Fact>
          <Fact label="Контекст Sales">{salesStage} · {salesSource}</Fact>
          <Fact label="ID дела">
            <span className="font-mono text-xs">{handoff.studentCaseId}</span>
          </Fact>
          <Fact label="ID лида">
            <span className="font-mono text-xs">{handoff.leadId}</span>
          </Fact>
          <Fact label="ID клиента">
            <span className="font-mono text-xs">
              {handoff.clientContext.clientId}
            </span>
          </Fact>
          <Fact label="Версии">
            gate {handoff.gateVersion} · workflow {handoff.workflowVersion}
          </Fact>
        </dl>
        <div className="border-t border-border px-4 py-3 text-sm leading-5 text-fg-2">
          <p className="text-2xs font-semibold uppercase tracking-wide text-fg-3">
            Причина передачи
          </p>
          <p
            className="mt-1"
            data-testid={exceptional ? "canonical-handoff-override-reason" : undefined}
          >
            {handoff.handoffReason}
          </p>
        </div>
        <div className="border-t border-border px-4 py-3">
          <p className="text-2xs font-semibold uppercase tracking-wide text-fg-3">
            Стартовые задачи
          </p>
          {handoff.starterTasks.length === 0 ? (
            <p className="mt-2 text-sm text-fg-3">Стартовых задач нет.</p>
          ) : (
            <ul className="mt-2 divide-y divide-border">
              {handoff.starterTasks.map((task) => (
                <li
                  key={task.taskId}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-sm"
                  data-testid="v3-profile-handoff-starter-task"
                >
                  <span className="min-w-0 flex-1 font-medium text-fg">
                    {task.title}
                  </span>
                  <span className="text-fg-3">{task.assigneeDisplayName}</span>
                  <Pill tone={task.status === "done" ? "ok" : "neutral"}>
                    {task.status}
                  </Pill>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </Card>
  );
}

export function ProfileContractWorkspace({
  snapshot,
  presentationRole,
  authorityRole,
  organizationId,
  result,
  retry,
}: Readonly<{
  snapshot: ProfileContractSnapshot;
  presentationRole: ProfileActorRole;
  authorityRole: ProfileActorRole;
  organizationId: string;
  result?: PlatformContractMutationOutcome;
  retry?: ProfileContractRetry;
}>) {
  if (presentationRole === "sales") return null;
  if (
    snapshot.workspace.organizationId !== organizationId ||
    snapshot.handoff.organizationId !== organizationId ||
    snapshot.workspace.studentCaseId !== snapshot.handoff.studentCaseId
  ) {
    throw new Error("V3 contract workspace identity does not match the active case.");
  }

  return (
    <div
      className="flex flex-col gap-4"
      data-testid="v3-profile-contract-workspace"
      data-student-case-id={snapshot.workspace.studentCaseId}
    >
      <HandoffContext handoff={snapshot.handoff} />
      <ContractDraftReportWorkspace
        workspace={snapshot.workspace}
        actions={CONTRACT_ACTIONS}
        requestIdFor={buildRequestIdFactory(retry)}
        result={result}
        retrySubjectId={retry?.subjectId}
      />
      <ProfileAmoCrmCommandSection
        organizationId={organizationId}
        authorityRole={authorityRole}
        handoff={snapshot.handoff}
      />
    </div>
  );
}
