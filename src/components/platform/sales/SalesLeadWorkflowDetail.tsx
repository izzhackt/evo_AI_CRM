import Link from "next/link";

import { Icon } from "@/components/icons";
import {
  CanonicalAuthorityNotice,
  CanonicalKeyBadge,
  CanonicalUuid,
  DuplicateStatus,
  formatCanonicalTimestamp,
  humanizeCanonicalKey,
} from "@/components/platform/core/CanonicalRecordsPresentation";
import { PageHeader, btnGhostCls } from "@/components/ui";
import type { Locale } from "@/lib/i18n";
import {
  type PlatformSalesLeadWorkflowDetail,
  type PlatformSalesOwnerCursor,
  type PlatformSalesOwnerOption,
  type PlatformSalesStage,
} from "@/lib/platform-sales-workflow";

import { SalesLeadWorkflowForm } from "./SalesLeadWorkflowForm";

const STAGE_COPY: Record<Locale, Record<PlatformSalesStage, string>> = {
  ru: {
    new: "Новый",
    contacting: "Связываемся",
    qualified: "Квалифицирован",
    meeting_scheduled: "Встреча назначена",
    meeting_completed: "Встреча проведена",
    potential: "Потенциальный клиент",
  },
  ky: {
    new: "Жаңы",
    contacting: "Байланышуудабыз",
    qualified: "Квалификациядан өттү",
    meeting_scheduled: "Жолугушуу дайындалды",
    meeting_completed: "Жолугушуу өттү",
    potential: "Потенциалдуу кардар",
  },
  en: {
    new: "New",
    contacting: "Contacting",
    qualified: "Qualified",
    meeting_scheduled: "Meeting scheduled",
    meeting_completed: "Meeting completed",
    potential: "Potential",
  },
};

const COPY = {
  ru: {
    back: "К лидам",
    eyebrow: "Квалификация лида EVO",
    fallbackName: "Лид без связанного клиента",
    description:
      "Сохранённые этап, ответственный и следующий шаг. Любое изменение проходит одной транзакцией и получает запись аудита.",
    facts: "Текущее подтверждённое состояние",
    stage: "Этап квалификации",
    owner: "Ответственный Sales",
    unassigned: "Не назначен",
    nextAction: "Следующее действие",
    noAction: "Не запланировано",
    due: "Срок",
    noDue: "Не задан",
    overdue: "Просрочено",
    today: "Сегодня",
    connection: "Связь с перепиской",
    connected: "Connected · прямая связь есть",
    unconnected: "Unconnected · прямой связи нет",
    connectionHelp:
      "Это каноническая связь с перепиской EVO, а не доказательство состояния WhatsApp-провайдера.",
    source: "Источник",
    version: "Версия workflow",
    updated: "Обновлено",
    conversations: "Связанных диалогов",
    studentCases: "Связанных Student Cases",
    changeTitle: "Изменить квалификацию",
    changeDescription:
      "Форма отправляет полное желаемое состояние с ожидаемой версией; успех показывается только после ответа транзакции.",
    ownerUnavailable:
      "Список допустимых ответственных недоступен. Лид остаётся видимым, но сохранение отключено.",
  },
  ky: {
    back: "Лиддерге",
    eyebrow: "EVO лид квалификациясы",
    fallbackName: "Кардарга байланыша элек лид",
    description:
      "Сакталган этап, жооптуу жана кийинки кадам. Ар бир өзгөрүү бир транзакцияда аудитке жазылат.",
    facts: "Учурдагы ырасталган абал",
    stage: "Квалификация этабы",
    owner: "Sales жооптуусу",
    unassigned: "Дайындалган эмес",
    nextAction: "Кийинки аракет",
    noAction: "Пландалган эмес",
    due: "Мөөнөт",
    noDue: "Берилген эмес",
    overdue: "Мөөнөтү өткөн",
    today: "Бүгүн",
    connection: "Кат алышуу байланышы",
    connected: "Connected · түз байланыш бар",
    unconnected: "Unconnected · түз байланыш жок",
    connectionHelp:
      "Бул EVO кат алышуусу менен каноникалык байланыш; WhatsApp провайдеринин абалынын далили эмес.",
    source: "Булак",
    version: "Workflow версиясы",
    updated: "Жаңыртылды",
    conversations: "Байланышкан диалогдор",
    studentCases: "Байланышкан Student Cases",
    changeTitle: "Квалификацияны өзгөртүү",
    changeDescription:
      "Форма күтүлгөн версия менен толук абалды жөнөтөт; ийгилик транзакциядан кийин гана көрсөтүлөт.",
    ownerUnavailable:
      "Жооптуулар тизмеси жеткиликсиз. Лид көрүнөт, бирок сактоо өчүрүлгөн.",
  },
  en: {
    back: "Back to leads",
    eyebrow: "EVO lead qualification",
    fallbackName: "Lead without a linked client",
    description:
      "The stored stage, owner, and next action. Every change commits in one transaction with a durable audit event.",
    facts: "Current confirmed state",
    stage: "Qualification stage",
    owner: "Sales owner",
    unassigned: "Unassigned",
    nextAction: "Next action",
    noAction: "Not scheduled",
    due: "Due date",
    noDue: "Not set",
    overdue: "Overdue",
    today: "Today",
    connection: "Conversation link",
    connected: "Connected · direct link exists",
    unconnected: "Unconnected · no direct link",
    connectionHelp:
      "This is a canonical EVO conversation link, not proof of WhatsApp provider health.",
    source: "Source",
    version: "Workflow version",
    updated: "Updated",
    conversations: "Linked conversations",
    studentCases: "Linked Student Cases",
    changeTitle: "Change qualification",
    changeDescription:
      "The form sends the full desired state with an expected version; success appears only after the transaction receipt.",
    ownerUnavailable:
      "Eligible owner options are unavailable. The lead remains visible, but saving is disabled.",
  },
} as const;

export function SalesLeadWorkflowDetail({
  lead,
  locale,
  ownerOptions,
  ownerOptionsHasNext,
  ownerOptionsNextCursor,
  ownerSearchable,
  ownerOptionsUnavailable,
  requestId,
}: Readonly<{
  lead: PlatformSalesLeadWorkflowDetail;
  locale: Locale;
  ownerOptions: readonly PlatformSalesOwnerOption[];
  ownerOptionsHasNext: boolean;
  ownerOptionsNextCursor: PlatformSalesOwnerCursor | null;
  ownerSearchable: boolean;
  ownerOptionsUnavailable: boolean;
  requestId: string;
}>) {
  const copy = COPY[locale];
  const today = bishkekCalendarDate();
  const isOverdue = lead.nextActionDueDate !== null && lead.nextActionDueDate < today;
  const isDueToday = lead.nextActionDueDate === today;

  return (
    <div className="space-y-5" data-testid="sales-workflow-lead-detail">
      <Link href="/sales" className={btnGhostCls}>
        <Icon name="arrow-left" size={15} /> {copy.back}
      </Link>

      <PageHeader
        eyebrow={copy.eyebrow}
        title={lead.clientDisplayName ?? copy.fallbackName}
        description={copy.description}
      />
      <CanonicalAuthorityNotice locale={locale} />

      {ownerOptionsUnavailable ? (
        <Notice testId="sales-owner-options-unavailable">
          {copy.ownerUnavailable}
        </Notice>
      ) : null}

      <section className="border-y border-border py-4" aria-labelledby="sales-workflow-facts">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h2 id="sales-workflow-facts" className="text-[15px] font-semibold text-fg">
            {copy.facts}
          </h2>
          <CanonicalUuid value={lead.leadId} />
          <DuplicateStatus count={lead.openDuplicateCandidateCount} locale={locale} />
        </div>
        <dl className="grid gap-x-6 gap-y-5 sm:grid-cols-2 xl:grid-cols-4">
          <Fact label={copy.stage} testId="canonical-lead-stage">
            <span data-testid="sales-workflow-lead-stage" data-stage-key={lead.stage}>
              <CanonicalKeyBadge value={STAGE_COPY[locale][lead.stage]} tone="accent" />
            </span>
          </Fact>
          <Fact label={copy.owner} testId="canonical-lead-owner">
            <span data-testid="sales-workflow-lead-owner">
              {lead.currentOwnerDisplayName ?? copy.unassigned}
              {lead.currentOwnerMembershipId ? (
                <span className="mt-1 block">
                  <CanonicalUuid value={lead.currentOwnerMembershipId} />
                </span>
              ) : null}
            </span>
          </Fact>
          <Fact label={copy.nextAction} testId="sales-workflow-lead-next-action">
            {lead.nextActionText ?? copy.noAction}
          </Fact>
          <Fact label={copy.due} testId="sales-workflow-lead-due-date">
            {lead.nextActionDueDate ? (
              <span className="flex flex-wrap items-center gap-2">
                <time dateTime={lead.nextActionDueDate} className="font-mono">
                  {lead.nextActionDueDate}
                </time>
                {isOverdue ? (
                  <span className="rounded-full bg-danger-weak px-2 py-0.5 font-semibold text-danger">
                    {copy.overdue}
                  </span>
                ) : isDueToday ? (
                  <span className="rounded-full bg-warn-weak px-2 py-0.5 font-semibold text-warn">
                    {copy.today}
                  </span>
                ) : null}
              </span>
            ) : copy.noDue}
          </Fact>
          <Fact label={copy.connection} testId="sales-workflow-lead-connection">
            <span className={lead.isConnected ? "font-semibold text-ok" : "font-semibold text-fg-2"}>
              {lead.isConnected ? copy.connected : copy.unconnected}
            </span>
            <span className="mt-1 block text-[11px] leading-4 text-fg-3">
              {copy.connectionHelp}
            </span>
          </Fact>
          <Fact label={copy.source}>{humanizeCanonicalKey(lead.sourceKey)}</Fact>
          <Fact label={copy.version}>
            <span className="font-mono">{lead.workflowVersion}</span>
          </Fact>
          <Fact label={copy.updated}>
            <span className="font-mono text-[11.5px]">
              {formatCanonicalTimestamp(lead.updatedAt, locale)}
            </span>
          </Fact>
          <Fact label={copy.conversations}>{lead.linkedConversationCount}</Fact>
          <Fact label={copy.studentCases}>{lead.linkedStudentCaseCount}</Fact>
        </dl>
      </section>

      <section className="space-y-3" aria-labelledby="sales-workflow-change">
        <div className="space-y-1">
          <h2 id="sales-workflow-change" className="text-[15px] font-semibold text-fg">
            {copy.changeTitle}
          </h2>
          <p className="max-w-4xl text-[12.5px] leading-5 text-fg-3">
            {copy.changeDescription}
          </p>
        </div>
        <SalesLeadWorkflowForm
          lead={lead}
          locale={locale === "en" ? "en" : "ru"}
          ownerOptions={ownerOptions}
          ownerOptionsHasNext={ownerOptionsHasNext}
          ownerOptionsNextCursor={ownerOptionsNextCursor}
          ownerSearchable={ownerSearchable}
          ownerOptionsUnavailable={ownerOptionsUnavailable}
          requestId={requestId}
        />
      </section>
    </div>
  );
}

function Fact({
  children,
  label,
  testId,
}: Readonly<{
  children: React.ReactNode;
  label: string;
  testId?: string;
}>) {
  return (
    <div className="min-w-0" data-testid={testId}>
      <dt className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-fg-3">
        {label}
      </dt>
      <dd className="mt-1.5 break-words text-[12.5px] text-fg-2">{children}</dd>
    </div>
  );
}

function Notice({
  children,
  testId,
}: Readonly<{ children: React.ReactNode; testId: string }>) {
  return (
    <div
      className="border-l-[3px] border-warn bg-warn-weak px-4 py-3 text-[12.5px] leading-5 text-fg-2"
      data-testid={testId}
    >
      {children}
    </div>
  );
}

function bishkekCalendarDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Bishkek",
    year: "numeric",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}
