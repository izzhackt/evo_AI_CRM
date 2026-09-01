import {
  Badge,
  EmptyState,
  btnCls,
  btnDangerGhostCls,
  btnGhostCls,
  cn,
  inputCls,
  labelCls,
} from "@/components/ui";
import { ContextBanner } from "@/components/platform/operations/OperationsPrimitives";
import type {
  PlatformCaseContractWorkspace,
  PlatformContractMutationOutcome,
} from "@/lib/platform-contract-workflow";

export type ContractDraftReportFormAction = (
  formData: FormData,
) => void | Promise<void>;

export type ContractDraftReportActions = Readonly<{
  createTemplate: ContractDraftReportFormAction;
  approveTemplate: ContractDraftReportFormAction;
  retireTemplate: ContractDraftReportFormAction;
  generateDraft: ContractDraftReportFormAction;
  reviewDraft: ContractDraftReportFormAction;
  seedItems: ContractDraftReportFormAction;
  updateItem: ContractDraftReportFormAction;
  generateReport: ContractDraftReportFormAction;
  reviewReport: ContractDraftReportFormAction;
}>;

export type ContractDraftReportResult = PlatformContractMutationOutcome;

export type ContractDraftReportRequestIdFor = (
  operation: string,
  subjectId?: string,
) => string;

type Workspace = PlatformCaseContractWorkspace;
type Template = Workspace["templates"][number];
type Draft = Workspace["drafts"][number];
type Item = Workspace["items"][number];
type Report = Workspace["reports"][number];

function templateLabel(template: Template | undefined, fallbackId: string): string {
  return template ? `${template.title} · v${template.version}` : fallbackId;
}

const RESULT_COPY: Record<
  ContractDraftReportResult,
  Readonly<{
    tone: "info" | "warning" | "danger";
    title: string;
    description: string;
  }>
> = {
  template_created: {
    tone: "info",
    title: "Версия шаблона создана",
    description: "Черновик шаблона сохранён с проверяемым источником и ожидает отдельного утверждения.",
  },
  template_approved: {
    tone: "info",
    title: "Шаблон утверждён",
    description: "Эта неизменяемая версия доступна для генерации договора.",
  },
  template_retired: {
    tone: "info",
    title: "Шаблон выведен из использования",
    description: "Исторические договоры сохраняют исходную версию; новые черновики её не используют.",
  },
  draft_generated: {
    tone: "info",
    title: "Черновик договора создан",
    description: "Текст сформирован сервером только из разрешённых типизированных полей и ещё не утверждён.",
  },
  draft_approved: {
    tone: "info",
    title: "Версия договора утверждена",
    description: "Решение и неизменяемый hash записаны в аудит EVO Platform.",
  },
  draft_rejected: {
    tone: "warning",
    title: "Версия договора отклонена",
    description: "Отклонённая версия остаётся в истории; исправление требует новой генерации.",
  },
  items_seeded: {
    tone: "info",
    title: "Постдоговорный чек-лист создан",
    description: "Пункты созданы из утверждённой версии шаблона и теперь требуют фактического статуса.",
  },
  item_updated: {
    tone: "info",
    title: "Пункт чек-листа обновлён",
    description: "Статус, ответственный, evidence и следующий шаг сохранены аудируемой операцией.",
  },
  report_generated: {
    tone: "info",
    title: "Черновик отчёта создан",
    description: "Отчёт зафиксировал текущие валидные пункты и остаётся неизменяемым черновиком до review.",
  },
  report_approved: {
    tone: "info",
    title: "Отчёт утверждён",
    description: "Версия отчёта и её hash сохранены вместе с решением reviewer.",
  },
  report_rejected: {
    tone: "warning",
    title: "Отчёт отклонён",
    description: "Историческая версия сохранена. После исправления пунктов создайте новую версию отчёта.",
  },
  invalid: {
    tone: "warning",
    title: "Проверьте введённые данные",
    description: "Сервер отклонил форму. Исправьте значения и повторите только ту же операцию.",
  },
  unavailable: {
    tone: "danger",
    title: "Операция не подтверждена",
    description: "Сервер не подтвердил запись. Сохранённый request ID можно повторить только для той же операции.",
  },
  not_allowed: {
    tone: "danger",
    title: "Действие недоступно",
    description: "Роль, назначение или состояние кейса не разрешают эту операцию. Данные не изменены.",
  },
};

const textAreaCls = cn(inputCls, "h-auto min-h-24 resize-y py-2 font-mono text-xs");

function HiddenContext({
  studentCaseId,
  requestId,
}: {
  studentCaseId: string;
  requestId: string;
}) {
  return (
    <>
      <input type="hidden" name="student_case_id" value={studentCaseId} />
      <input type="hidden" name="request_id" value={requestId} />
    </>
  );
}

function ReasonField({ id }: { id: string }) {
  return (
    <label className={labelCls} htmlFor={id}>
      Причина
      <input
        id={id}
        name="reason"
        required
        minLength={3}
        maxLength={500}
        className={cn(inputCls, "mt-1")}
      />
    </label>
  );
}

function EvidenceHash({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 border-b border-border pb-3">
      <dt className="text-xs font-semibold uppercase tracking-[0.04em] text-fg-3">{label}</dt>
      <dd className="mt-1 break-all font-mono text-xs text-fg-2">{value}</dd>
    </div>
  );
}

function ArtifactMeta({
  createdBy,
  createdAt,
  reviewedBy,
  reviewedAt,
}: {
  createdBy: string;
  createdAt: string;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
}) {
  return (
    <dl className="grid gap-x-5 gap-y-3 sm:grid-cols-2">
      <div className="min-w-0 border-b border-border pb-3">
        <dt className="text-xs font-semibold uppercase tracking-[0.04em] text-fg-3">Создал</dt>
        <dd className="mt-1 break-all font-mono text-xs text-fg-2">{createdBy}</dd>
        <dd className="mt-1 font-mono text-2xs text-fg-3">{createdAt}</dd>
      </div>
      <div className="min-w-0 border-b border-border pb-3">
        <dt className="text-xs font-semibold uppercase tracking-[0.04em] text-fg-3">Review</dt>
        <dd className="mt-1 break-all font-mono text-xs text-fg-2">{reviewedBy ?? "—"}</dd>
        <dd className="mt-1 font-mono text-2xs text-fg-3">{reviewedAt ?? "—"}</dd>
      </div>
    </dl>
  );
}

function ReviewForms({
  kind,
  id,
  studentCaseId,
  action,
  requestIdFor,
}: {
  kind: "draft" | "report";
  id: string;
  studentCaseId: string;
  action: ContractDraftReportFormAction;
  requestIdFor: ContractDraftReportRequestIdFor;
}) {
  const idName = kind === "draft"
    ? "student_case_contract_draft_id"
    : "post_contract_report_id";
  const operation = kind === "draft" ? "review_draft" : "review_report";
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {(["approved", "rejected"] as const).map((decision) => (
        <form
          key={decision}
          action={action}
          data-testid={`platform-contract-${kind}-${decision}-form`}
          className="rounded-nav border border-border bg-surface-2 p-3"
        >
          <HiddenContext
            studentCaseId={studentCaseId}
            requestId={requestIdFor(operation, id)}
          />
          <input type="hidden" name={idName} value={id} />
          <input type="hidden" name="decision" value={decision} />
          <ReasonField id={`${kind}-${id}-${decision}-reason`} />
          <button
            type="submit"
            className={decision === "approved" ? btnGhostCls : btnDangerGhostCls}
          >
            {decision === "approved" ? "Утвердить" : "Отклонить"}
          </button>
        </form>
      ))}
    </div>
  );
}

function TemplateLifecycle({
  workspace,
  template,
  actions,
  requestIdFor,
}: {
  workspace: Workspace;
  template: Template;
  actions: ContractDraftReportActions;
  requestIdFor: ContractDraftReportRequestIdFor;
}) {
  const source = workspace.reviewedSources.find(
    (candidate) => candidate.sourceRegistryId === template.sourceRegistryId,
  );
  return (
    <article
      className="space-y-3 border-t border-border pt-4 first:border-0 first:pt-0"
      data-testid="platform-contract-template-version"
      data-template-id={template.contractTemplateVersionId}
      data-template-key={template.templateKey}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-base font-bold text-fg">{template.title}</h4>
          <p className="mt-1 font-mono text-xs text-fg-3">
            {template.templateKey} · v{template.version}
          </p>
        </div>
        <Badge value={template.status} label={template.status} />
      </div>
      <dl className="grid gap-x-5 gap-y-3 sm:grid-cols-2">
        <div className="min-w-0 border-b border-border pb-3">
          <dt className="text-xs font-semibold uppercase tracking-[0.04em] text-fg-3">Канонический источник</dt>
          <dd className="mt-1 break-all text-xs text-fg-2">
            {source ? (
              <a className="text-accent underline-offset-2 hover:underline" href={source.sourceUrl} target="_blank" rel="noreferrer">
                {source.sourceUrl}
              </a>
            ) : "Источник недоступен этой роли"}
          </dd>
          <dd className="mt-1 font-mono text-2xs text-fg-3">
            revision: {template.sourceRevision}
          </dd>
        </div>
        <EvidenceHash label="Template SHA-256" value={template.templateSha256} />
        <EvidenceHash label="Checklist SHA-256" value={template.blueprintSha256} />
      </dl>
      <ArtifactMeta
        createdBy={template.createdByMembershipId}
        createdAt={template.createdAt}
        reviewedBy={template.retiredByMembershipId ?? template.approvedByMembershipId}
        reviewedAt={template.retiredAt ?? template.approvedAt}
      />
      {workspace.canManageTemplates && (template.status === "draft" || template.status === "approved") ? (
        <form
          action={template.status === "draft" ? actions.approveTemplate : actions.retireTemplate}
          data-testid={template.status === "draft"
            ? "platform-contract-template-approve-form"
            : "platform-contract-template-retire-form"}
          className="grid gap-3 rounded-nav border border-border bg-surface-2 p-3 sm:grid-cols-[1fr_auto] sm:items-end"
        >
          <HiddenContext
            studentCaseId={workspace.studentCaseId}
            requestId={requestIdFor(
              template.status === "draft" ? "approve_template" : "retire_template",
              template.contractTemplateVersionId,
            )}
          />
          <input
            type="hidden"
            name="contract_template_version_id"
            value={template.contractTemplateVersionId}
          />
          <ReasonField id={`template-${template.contractTemplateVersionId}-${template.status}-reason`} />
          <button
            type="submit"
            className={template.status === "draft" ? btnGhostCls : btnDangerGhostCls}
          >
            {template.status === "draft" ? "Утвердить версию" : "Вывести версию"}
          </button>
        </form>
      ) : null}
    </article>
  );
}

function DraftArtifact({
  workspace,
  draft,
  actions,
  requestIdFor,
}: {
  workspace: Workspace;
  draft: Draft;
  actions: ContractDraftReportActions;
  requestIdFor: ContractDraftReportRequestIdFor;
}) {
  return (
    <article
      className="space-y-3 border-t border-border pt-4 first:border-0 first:pt-0"
      data-testid="platform-contract-draft-version"
      data-draft-id={draft.studentCaseContractDraftId}
      data-draft-version={draft.version}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h4 className="text-base font-bold text-fg">Договор · v{draft.version}</h4>
        <Badge value={draft.status} label={draft.status} />
      </div>
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-nav border border-border bg-surface-2 p-4 font-mono text-xs leading-6 text-fg" data-testid="platform-contract-rendered-draft">
        {draft.renderedText}
      </pre>
      <dl className="grid gap-x-5 gap-y-3 sm:grid-cols-2">
        <EvidenceHash label="Input SHA-256" value={draft.inputSha256} />
        <EvidenceHash label="Rendered SHA-256" value={draft.renderedSha256} />
      </dl>
      <ArtifactMeta
        createdBy={draft.createdByMembershipId}
        createdAt={draft.createdAt}
        reviewedBy={draft.reviewedByMembershipId}
        reviewedAt={draft.reviewedAt}
      />
      {workspace.canReviewContract && draft.status === "draft" ? (
        <ReviewForms
          kind="draft"
          id={draft.studentCaseContractDraftId}
          studentCaseId={workspace.studentCaseId}
          action={actions.reviewDraft}
          requestIdFor={requestIdFor}
        />
      ) : null}
    </article>
  );
}

function PostContractItemForm({
  workspace,
  item,
  action,
  requestIdFor,
}: {
  workspace: Workspace;
  item: Item;
  action: ContractDraftReportFormAction;
  requestIdFor: ContractDraftReportRequestIdFor;
}) {
  return (
    <form
      action={action}
      data-testid="platform-post-contract-item-form"
      className="grid gap-3 lg:grid-cols-2"
    >
      <HiddenContext
        studentCaseId={workspace.studentCaseId}
        requestId={requestIdFor("update_item", item.postContractItemId)}
      />
      <input type="hidden" name="post_contract_item_id" value={item.postContractItemId} />
      <input type="hidden" name="expected_revision" value={item.revision} />
      <label className={labelCls}>
        Статус
        <select name="status" defaultValue={item.status} required className={cn(inputCls, "mt-1")}>
          <option value="open">open</option>
          <option value="in_progress">in_progress</option>
          <option value="blocked">blocked</option>
          <option value="delivered">delivered</option>
        </select>
      </label>
      <label className={labelCls}>
        Membership ID ответственного
        <input
          name="owner_membership_id"
          defaultValue={item.ownerMembershipId ?? ""}
          maxLength={36}
          className={cn(inputCls, "mt-1 font-mono text-xs")}
        />
      </label>
      <label className={labelCls}>
        Следующее действие
        <textarea
          name="next_action"
          defaultValue={item.nextAction ?? ""}
          maxLength={1000}
          rows={2}
          className={cn(inputCls, "mt-1 h-auto resize-y py-2")}
        />
      </label>
      <label className={labelCls}>
        Evidence reference
        <input
          name="evidence_ref"
          defaultValue={item.evidenceRef ?? ""}
          maxLength={512}
          className={cn(inputCls, "mt-1")}
        />
      </label>
      <div className="lg:col-span-2">
        <ReasonField id={`post-contract-item-${item.postContractItemId}-reason`} />
      </div>
      <div className="lg:col-span-2">
        <button type="submit" className={btnGhostCls}>Сохранить пункт</button>
      </div>
    </form>
  );
}

function ReportArtifact({
  workspace,
  report,
  actions,
  requestIdFor,
}: {
  workspace: Workspace;
  report: Report;
  actions: ContractDraftReportActions;
  requestIdFor: ContractDraftReportRequestIdFor;
}) {
  const template = workspace.templates.find(
    (candidate) =>
      candidate.contractTemplateVersionId === report.contractTemplateVersionId,
  );
  return (
    <article
      className="space-y-3 border-t border-border pt-4 first:border-0 first:pt-0"
      data-testid="platform-post-contract-report-version"
      data-report-id={report.postContractReportId}
      data-report-version={report.version}
      data-template-id={report.contractTemplateVersionId}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h4 className="text-base font-bold text-fg">Постдоговорный отчёт · v{report.version}</h4>
        <Badge value={report.status} label={report.status} />
      </div>
      <p className="text-xs text-fg-3">
        Шаблон: {templateLabel(template, report.contractTemplateVersionId)}
      </p>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {[
          ["Всего", report.totalItemCount],
          ["Доставлено", report.deliveredItemCount],
          ["Открыто", report.openItemCount],
          ["В работе", report.inProgressItemCount],
          ["Заблокировано", report.blockedItemCount],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-nav border border-border bg-surface-2 p-3">
            <dt className="text-2xs font-semibold uppercase tracking-[0.04em] text-fg-3">{label}</dt>
            <dd className="mt-1 font-mono text-xl font-bold text-fg">{value}</dd>
          </div>
        ))}
      </dl>
      <ul className="divide-y divide-border rounded-nav border border-border" aria-label={`Пункты отчёта v${report.version}`}>
        {report.itemSnapshot.map((item) => (
          <li
            key={item.postContractItemId}
            data-testid="platform-post-contract-report-item"
            data-item-id={item.postContractItemId}
            data-template-id={report.contractTemplateVersionId}
            className="grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="text-sm font-semibold text-fg">{item.label}</p>
                <Badge value={item.status} label={item.status} />
              </div>
              <p className="mt-1 break-all font-mono text-2xs text-fg-3">
                owner: {item.ownerMembershipId} ({item.ownerRole}) · revision {item.revision}
              </p>
            </div>
            <dl className="grid gap-2 text-xs">
              <div>
                <dt className="font-semibold text-fg-3">Evidence</dt>
                <dd className="mt-0.5 break-all text-fg-2">{item.evidenceRef ?? "—"}</dd>
              </div>
              <div>
                <dt className="font-semibold text-fg-3">Следующее действие</dt>
                <dd className="mt-0.5 whitespace-pre-wrap text-fg-2">{item.nextAction ?? "—"}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
      <dl>
        <EvidenceHash label="Report SHA-256" value={report.reportSha256} />
      </dl>
      <ArtifactMeta
        createdBy={report.createdByMembershipId}
        createdAt={report.createdAt}
        reviewedBy={report.reviewedByMembershipId}
        reviewedAt={report.reviewedAt}
      />
      {workspace.canReviewReport && report.status === "draft" ? (
        <ReviewForms
          kind="report"
          id={report.postContractReportId}
          studentCaseId={workspace.studentCaseId}
          action={actions.reviewReport}
          requestIdFor={requestIdFor}
        />
      ) : null}
    </article>
  );
}

export function ContractDraftReportWorkspace({
  workspace,
  actions,
  requestIdFor,
  result,
  retrySubjectId,
}: {
  workspace: PlatformCaseContractWorkspace;
  actions: ContractDraftReportActions;
  requestIdFor: ContractDraftReportRequestIdFor;
  result?: ContractDraftReportResult;
  retrySubjectId?: string;
}) {
  const approvedTemplates = workspace.templates.filter((template) => template.status === "approved");
  const templateById = new Map(
    workspace.templates.map((template) => [template.contractTemplateVersionId, template]),
  );
  const reportableTemplateIds = new Set(
    workspace.items.map((item) => item.contractTemplateVersionId),
  );
  const reportableTemplates = workspace.templates.filter((template) =>
    reportableTemplateIds.has(template.contractTemplateVersionId),
  );
  const hasReviewedSource = workspace.reviewedSources.some((source) => source.reviewStatus === "reviewed");
  const banner = result ? RESULT_COPY[result] : undefined;

  return (
    <section
      id="contract-workflow"
      data-testid="platform-contract-draft-report-workspace"
      aria-labelledby="contract-workflow-title"
      className="scroll-mt-24 space-y-4 rounded-card border border-border bg-surface p-4 shadow-evo sm:p-5"
    >
      <div>
        <h2 id="contract-workflow-title" className="mt-1 text-lg font-black tracking-[-0.02em] text-fg">
          Договор и постдоговорный отчёт
        </h2>
        <p className="mt-1 max-w-[56ch] text-sm leading-5 text-fg-3">
          Версии создаются только из проверенного источника и разрешённых типизированных полей. Черновик не является подписанным юридическим договором или доказательством доставки.
        </p>
      </div>

      {banner ? (
        <ContextBanner tone={banner.tone} title={banner.title} description={banner.description} />
      ) : null}

      <ContextBanner
        tone="info"
        title="Без provider claims и скрытого HTML"
        description="EVO Platform показывает детерминированный plain-text draft, версии и hash. PDF/DOCX, e-sign, отправка клиенту и содержимое внешних документов здесь не выполняются и не заявляются."
      />

      {!hasReviewedSource || approvedTemplates.length === 0 ? (
        <ContextBanner
          tone="warning"
          title="Нет утверждённого реального шаблона"
          description={!hasReviewedSource
            ? "Сначала Admin должен зарегистрировать и review проверяемый источник. До этого договор не генерируется и production content не подменяется примером."
            : "Проверенный источник доступен, но ни одна версия шаблона ещё не утверждена. Генерация остаётся fail-closed."}
        />
      ) : null}

      {workspace.canManageTemplates ? (
        <details className="rounded-nav border border-border bg-surface-2 p-4" data-testid="platform-contract-template-create-panel">
          <summary className="cursor-pointer text-base font-bold text-fg">Создать версию шаблона</summary>
          <form
            action={actions.createTemplate}
            data-testid="platform-contract-template-create-form"
            className="mt-4 grid gap-3 sm:grid-cols-2"
          >
            <HiddenContext
              studentCaseId={workspace.studentCaseId}
              requestId={requestIdFor("create_template")}
            />
            <label className={labelCls}>
              Ключ шаблона
              <input
                name="template_key"
                required
                minLength={12}
                maxLength={64}
                pattern="contract_[a-z][a-z0-9_]{1,55}"
                className={cn(inputCls, "mt-1 font-mono")}
              />
            </label>
            <label className={labelCls}>
              Название
              <input name="title" required minLength={3} maxLength={200} className={cn(inputCls, "mt-1")} />
            </label>
            <label className={cn(labelCls, "sm:col-span-2")}>
              Проверенный источник
              <select name="source_registry_id" required className={cn(inputCls, "mt-1")} defaultValue="">
                <option value="" disabled>Выберите source URL и revision</option>
                {workspace.reviewedSources.filter((source) => source.reviewStatus === "reviewed").map((source) => (
                  <option key={source.sourceRegistryId} value={source.sourceRegistryId}>
                    {source.sourceUrl} · {source.sourceRevision}
                  </option>
                ))}
              </select>
            </label>
            <label className={cn(labelCls, "sm:col-span-2")}>
              Plain-text шаблон
              <textarea name="template_text" required minLength={10} maxLength={20_000} rows={8} className={textAreaCls} aria-describedby="contract-template-text-hint" />
              <span id="contract-template-text-hint" className="mt-1 block text-xs font-normal leading-4 text-fg-3">
                Только текст и объявленные placeholders. Значение никогда не вставляется как HTML.
              </span>
            </label>
            <label className={labelCls}>
              Typed manifest · по одной строке
              <textarea name="manifest_lines" required minLength={5} maxLength={10_000} rows={6} className={textAreaCls} aria-describedby="contract-manifest-hint" />
              <span id="contract-manifest-hint" className="mt-1 block text-xs font-normal leading-4 text-fg-3">
                field_key|source_path|value_type|required
              </span>
            </label>
            <label className={labelCls}>
              Checklist blueprint · по одной строке
              <textarea name="checklist_lines" required minLength={5} maxLength={10_000} rows={6} className={textAreaCls} aria-describedby="contract-checklist-hint" />
              <span id="contract-checklist-hint" className="mt-1 block text-xs font-normal leading-4 text-fg-3">
                item_key|label|owner_role|next_action
              </span>
            </label>
            <div className="sm:col-span-2">
              <ReasonField id="contract-template-create-reason" />
              <button type="submit" className={btnCls} disabled={!hasReviewedSource}>Создать неизменяемую версию</button>
            </div>
          </form>
        </details>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="min-w-0 rounded-nav border border-border p-4" aria-labelledby="contract-template-list-title">
          <h3 id="contract-template-list-title" className="text-base font-bold text-fg">Версии шаблона</h3>
          <div className="mt-4 space-y-4" data-testid="platform-contract-template-list">
            {workspace.templates.length > 0 ? workspace.templates.map((template) => (
              <TemplateLifecycle key={template.contractTemplateVersionId} workspace={workspace} template={template} actions={actions} requestIdFor={requestIdFor} />
            )) : <EmptyState text="Версий шаблона нет." />}
          </div>
        </section>

        <section className="min-w-0 rounded-nav border border-border p-4" aria-labelledby="contract-draft-list-title">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 id="contract-draft-list-title" className="text-base font-bold text-fg">Неизменяемые версии договора</h3>
              <p className="mt-1 text-xs leading-4 text-fg-3">Новая генерация всегда создаёт новую версию.</p>
            </div>
          </div>
          {workspace.canGenerateContract ? (
            <form action={actions.generateDraft} data-testid="platform-contract-draft-generate-form" className="mt-4 grid gap-3 rounded-nav border border-border bg-surface-2 p-3">
              <HiddenContext studentCaseId={workspace.studentCaseId} requestId={requestIdFor("generate_draft", retrySubjectId)} />
              <label className={labelCls}>
                Утверждённая версия шаблона
                <select
                  name="contract_template_version_id"
                  required
                  defaultValue={approvedTemplates.some((template) => template.contractTemplateVersionId === retrySubjectId) ? retrySubjectId : ""}
                  className={cn(inputCls, "mt-1")}
                >
                  <option value="" disabled>Выберите версию</option>
                  {approvedTemplates.map((template) => <option key={template.contractTemplateVersionId} value={template.contractTemplateVersionId}>{template.title} · v{template.version}</option>)}
                </select>
              </label>
              <ReasonField id="contract-draft-generate-reason" />
              <button type="submit" className={btnCls} disabled={approvedTemplates.length === 0}>Сгенерировать plain-text draft</button>
            </form>
          ) : null}
          <div className="mt-4 space-y-4" data-testid="platform-contract-draft-list">
            {workspace.drafts.length > 0 ? workspace.drafts.map((draft) => (
              <DraftArtifact key={draft.studentCaseContractDraftId} workspace={workspace} draft={draft} actions={actions} requestIdFor={requestIdFor} />
            )) : <EmptyState text="Версий договора нет. Генерация заблокирована до утверждённого шаблона и разрешённого состояния кейса." />}
          </div>
        </section>
      </div>

      <section className="rounded-nav border border-border p-4" aria-labelledby="post-contract-items-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 id="post-contract-items-title" className="text-base font-bold text-fg">Постдоговорный чек-лист</h3>
            <p className="mt-1 text-xs leading-4 text-fg-3">Delivered требует evidence. Open, in progress и blocked требуют owner и следующего действия.</p>
          </div>
        </div>
        {workspace.canManagePostContract ? (
          <form action={actions.seedItems} data-testid="platform-post-contract-seed-form" className="mt-4 grid gap-3 rounded-nav border border-border bg-surface-2 p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <HiddenContext studentCaseId={workspace.studentCaseId} requestId={requestIdFor("seed_items", retrySubjectId)} />
            <label className={labelCls}>
              Утверждённый blueprint
              <select
                name="contract_template_version_id"
                required
                defaultValue={approvedTemplates.some((template) => template.contractTemplateVersionId === retrySubjectId) ? retrySubjectId : ""}
                className={cn(inputCls, "mt-1")}
              >
                <option value="" disabled>Выберите версию</option>
                {approvedTemplates.map((template) => <option key={template.contractTemplateVersionId} value={template.contractTemplateVersionId}>{template.title} · v{template.version}</option>)}
              </select>
            </label>
            <ReasonField id="post-contract-seed-reason" />
            <button type="submit" className={btnGhostCls} disabled={approvedTemplates.length === 0}>Создать пункты</button>
          </form>
        ) : null}
        <div className="mt-4 divide-y divide-border" data-testid="platform-post-contract-item-list">
          {workspace.items.length > 0 ? workspace.items.map((item) => (
            <article
              key={item.postContractItemId}
              className="space-y-3 py-4 first:pt-0 last:pb-0"
              data-testid="platform-post-contract-item"
              data-item-id={item.postContractItemId}
              data-item-key={item.itemKey}
              data-template-id={item.contractTemplateVersionId}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h4 className="text-base font-bold text-fg">{item.label}</h4>
                  <p className="mt-1 font-mono text-2xs text-fg-3">
                    {item.itemKey} · revision {item.revision} · {templateLabel(
                      templateById.get(item.contractTemplateVersionId),
                      item.contractTemplateVersionId,
                    )}
                  </p>
                </div>
                <Badge value={item.status} label={item.status} />
              </div>
              <dl className="grid gap-3 sm:grid-cols-3">
                <div><dt className={labelCls}>Owner</dt><dd className="break-all font-mono text-xs text-fg-2">{item.ownerMembershipId ?? item.ownerRole}</dd></div>
                <div><dt className={labelCls}>Следующее действие</dt><dd className="max-w-[56ch] whitespace-pre-wrap text-xs text-fg-2">{item.nextAction ?? "—"}</dd></div>
                <div><dt className={labelCls}>Evidence</dt><dd className="break-all text-xs text-fg-2">{item.evidenceRef ?? "—"}</dd></div>
              </dl>
              {workspace.canManagePostContract ? <PostContractItemForm workspace={workspace} item={item} action={actions.updateItem} requestIdFor={requestIdFor} /> : null}
            </article>
          )) : <EmptyState text="Пункты ещё не созданы. Отчёт без валидного чек-листа недоступен." />}
        </div>
      </section>

      <section className="rounded-nav border border-border p-4" aria-labelledby="post-contract-report-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 id="post-contract-report-title" className="text-base font-bold text-fg">Версии постдоговорного отчёта</h3>
            <p className="mt-1 text-xs leading-4 text-fg-3">Каждая версия фиксирует delivered/open/blocked counts, owner, evidence и next action на момент генерации.</p>
          </div>
        </div>
        {workspace.canManagePostContract ? (
          <form action={actions.generateReport} data-testid="platform-post-contract-report-generate-form" className="mt-4 grid gap-3 rounded-nav border border-border bg-surface-2 p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <HiddenContext studentCaseId={workspace.studentCaseId} requestId={requestIdFor("generate_report", retrySubjectId)} />
            <label className={labelCls}>
              Версия чек-листа
              <select
                name="contract_template_version_id"
                required
                defaultValue={reportableTemplateIds.has(retrySubjectId ?? "") ? retrySubjectId : ""}
                className={cn(inputCls, "mt-1")}
              >
                <option value="" disabled>Выберите версию</option>
                {reportableTemplates.map((template) => (
                  <option key={template.contractTemplateVersionId} value={template.contractTemplateVersionId}>
                    {template.title} · v{template.version}
                  </option>
                ))}
              </select>
            </label>
            <ReasonField id="post-contract-report-generate-reason" />
            <button type="submit" className={btnCls} disabled={reportableTemplates.length === 0}>Создать новую версию отчёта</button>
          </form>
        ) : null}
        <div className="mt-4 space-y-4" data-testid="platform-post-contract-report-list">
          {workspace.reports.length > 0 ? workspace.reports.map((report) => (
            <ReportArtifact key={report.postContractReportId} workspace={workspace} report={report} actions={actions} requestIdFor={requestIdFor} />
          )) : <EmptyState text="Версий отчёта нет." />}
        </div>
      </section>
    </section>
  );
}
