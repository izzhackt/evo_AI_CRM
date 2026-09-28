import Link from "next/link";
import type { ReactNode } from "react";

import { Icon } from "@/components/icons";
import { btnCls } from "@/components/ui";
import { isStaffPreview, staffCan, staffHasPermission, staffPresentationCan } from "@/lib/platform-access";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import type { PlatformSalesOwnerOption, PlatformSalesStage } from "@/lib/platform-sales-contract";
import { dayInOrganizationTimezone } from "@/lib/platform-task-deadline";
import { buildV3InboxHref } from "@/lib/v3/inbox-href";
import { stageTrack } from "@/lib/v3/stages";
import type { CaseAgreementReadResult } from "@/lib/v3/case-agreement-source";
import { closureWords, source as sourceWord, sourceUnderLabel } from "@/lib/v3/wording";

import { DueWord } from "../blocks/DueWord";
import { Initials } from "../blocks/Initials";
import { StageTrack } from "../blocks/StageTrack";
import { dueWordOf } from "../queue/due-bucket";
import { TaskComposerDialog } from "../tasks/TaskComposerDialog";
import { TaskComposerContextMark, type TaskComposerPageContext } from "../tasks/task-composer-context";
import { FeedEvent, FeedNote } from "./FeedRow";
import { handoffFootnote, handoffStripView, stripCaseMoney, type StripCaseMoney, type StripText } from "./handoff-strip-view";
import { LeadConditionsCard, LeadEducationCard, LeadWishesCard, SaleConditionsRevisionProvider } from "./LeadCardFieldsForm";
import { LeadEditGroups, LeadMoreMenu } from "./LeadEditGroups";
import { LeadNoteComposer } from "./LeadNoteComposer";
import { LeadSaleConditions } from "./LeadSaleConditions";
import { LeadStepDrawer } from "./LeadStepDrawer";
import { HandoffResponseSummary, HandoffStripBlock, StripLine } from "./ProfileSalesTransition";
import { StudentPortalAccessControls } from "./StudentPortalAccessCard";
import { PlatformAccessCard } from "./tabs";
import {
  LEAD_GATE_ANCHOR,
  LEAD_PORTAL_GROUP_ID,
  LEAD_STEP_DRAWER_ID,
  contractWorkspaceWritable,
  hasHandoffGateForms,
  leadDay,
  leadFeed,
  leadGroupSummaries,
  leadLastContact,
  leadMoment,
  leadPrimaryAction,
  leadSaleHref,
  type LeadFeedEvent,
} from "./lead-work-view";
import {
  profileTabAccess,
  tabsFor,
  type PersonProfile,
  type ProfileDraft,
  type ProfileNotesSnapshot,
  type ProfileSalesRequestIds,
  type ProfileSalesSnapshot,
} from "./types";

/** Переход, который выглядит как спокойная кнопка: 44 px, рамка контрола, без красного. */
const ACTION_LINK = "inline-flex min-h-11 items-center gap-1.5 rounded-ctl border border-control-edge bg-surface px-3 t-label text-fg-2 hover:bg-surface-2 hover:text-fg";
/** Текстовая кнопка факта: 44 px по высоте, подчёркнута — без красного она остаётся действием. */
const FACT_ACTION = "inline-flex min-h-11 items-center t-label text-fg-2 underline underline-offset-4 hover:text-fg";
const QUIET_LINK = "inline-flex min-h-11 items-center t-label text-fg-2 underline underline-offset-4 hover:text-fg";
/** Вторичное действие у заголовка: на телефоне — значок 44 px (имя остаётся для чтения с экрана), от `sm` — со словом. */
const ICON_ACTION = `${ACTION_LINK} min-w-11 justify-center`;

export type LeadWorkPartsInput = Readonly<{
  actor: ActivePlatformActor;
  profile: PersonProfile;
  draft: ProfileDraft;
  sales: ProfileSalesSnapshot;
  notes: ProfileNotesSnapshot;
  notesOlderHref: string | null;
  notesLatestHref: string | null;
  /**
   * `portal` — приглашение в кабинет дела, `cabinetPortal` — ожидающего
   * кабинета лида: детерминированные id команды (`studentPortalProvisioningRequestId`);
   * пустая строка — такого дела нет.
   */
  requestIds: ProfileSalesRequestIds & Readonly<{ step: string; note: string; portal: string; cabinetPortal: string }>;
  /** Этапы формы решения — рабочие этапы доски, без «Переданы». */
  stages: readonly Readonly<{ key: PlatformSalesStage; title: string }>[];
  ownerOptions: readonly PlatformSalesOwnerOption[];
  ownerOptionsHaveMore: boolean;
  curators: readonly Readonly<{ membershipId: string; displayName: string }>[];
  curatorsAvailable: boolean;
  /**
   * Договор и платежи дела лида (чтение 188) для полосы «Передача» (Э8.4);
   * null — дела нет или «Обзор» не открыт. Отказ и сбой — полоса без них.
   */
  agreement?: CaseAgreementReadResult | null;
  /** «Заявки с сайта» — своё чтение (`WebsiteLeadSubmissions`); null — не показываются. */
  submissions: ReactNode;
  hrefFor: (tab: string) => string;
  now: Date;
}>;

/** Текст с датами: слова — Golos, даты — JetBrains Mono. */
function DatedText({ text }: Readonly<{ text: StripText }>) {
  return <>{text.map((part, index) => typeof part === "string"
    ? <span key={index}>{part}</span>
    : <time key={index} className="whitespace-nowrap font-mono tabular-nums">{part.date}</time>)}</>;
}

/** Факт шапки: подпись над значением; соседей разделяет волосяная линия. */
function HeaderFact({ term, wide = false, children }: Readonly<{ term: string; wide?: boolean; children: ReactNode }>) {
  return (
    <div className={`min-w-0 border-border py-2 sm:border-s sm:px-4 sm:first:border-s-0 sm:first:ps-0 ${wide ? "sm:min-w-[16rem] sm:flex-1" : ""}`}>
      <dt className="t-caption text-fg-2">{term}</dt>
      <dd className="mt-0.5 min-w-0 t-body-compact text-fg">{children}</dd>
    </div>
  );
}

/** Факт «Сведений»: строка на волосяной линии. */
function Fact({ term, children }: Readonly<{ term: string; children: ReactNode }>) {
  return (
    <div className="min-w-0 border-b border-border py-2.5 last:border-b-0">
      <dt className="t-caption text-fg-2">{term}</dt>
      <dd className="mt-0.5 min-w-0 break-words t-body-compact text-fg">{children}</dd>
    </div>
  );
}

/**
 * Группа правки: одна строка — название и что уже заполнено, раскрытие —
 * прежняя форма без своей карточки. `name` у всех групп один: открыта одна.
 */
function EditGroup({ id, title, summary, testId, children }: Readonly<{
  id?: string; title: string; summary: string | null; testId: string; children: ReactNode;
}>) {
  const shown = summary ?? "не заполнено";
  return (
    <details name="lead-edit" id={id} data-lead-group="" data-testid={testId} className="group scroll-mt-4 border-b border-border">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 rounded-nav py-1.5 [&::-webkit-details-marker]:hidden">
        {/* Строка заполненного — рядом с названием, а если места меньше 7rem — под ним во всю ширину. */}
        <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3">
          <span className="t-item text-fg">{title}</span>
          <span className={`min-w-28 flex-1 truncate t-meta ${summary ? "text-fg-2" : "text-fg-3"}`} title={shown}>{shown}</span>
        </span>
        <Icon name="chevron-down" size={18} className="shrink-0 text-fg-3 transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      <div className="pb-4 pt-1">{children}</div>
    </details>
  );
}

/** Состояние доступа к порталу словами — строка группы «Доступ к порталу». */
function portalSummary(draft: ProfileDraft): string {
  const application = draft.studentApplication;
  const cabinet = draft.admissions
    ? { state: draft.admissions.caseState }
    : draft.leadCabinetCase;
  if (application === null) {
    if (cabinet) return cabinet.state === "closed" ? "дело закрыто" : "дело создано";
    return "кабинет не подготовлен";
  }
  if (application.status === "approved") return "анкета одобрена";
  if (application.status === "rejected") return "анкета отклонена";
  return "анкета ждёт решения";
}

/**
 * Lead 360 (`?id=`) как рабочая карточка (Э4, 27.09.2026; решение владельца:
 * каждый день — доска и её панель, Lead 360 — для глубоких правок). Из уже
 * прочитанных данных собирает три части страницы:
 *
 * - `actions` — у заголовка: одно главное действие по состоянию
 *   (`leadPrimaryAction`), «Написать», «Задача по лиду» и «⋯» («Закрыть лид»);
 * - `header` — над вкладками: этап (дорожка этапа со словами доски) и
 *   «Что дальше» с правкой прежней формой решения доски в выдвижной панели;
 * - `overview` — «Обзор» как у дела (Э8.4): от 1280 px слева рабочая колонка —
 *   лента (заметки и события) с заметкой в одну строку, под ней свёрнутые
 *   группы «Данных лида» во всю её ширину, по одной, «Сохранить» спокойное;
 *   справа только факты — «Сведения» и полоса «Передача» (договор и оплата —
 *   одно место, «Изменить» ведёт на вкладку «Договор и оплата»). На телефоне:
 *   «Сведения», «Передача», лента, группы.
 *
 * Права — подсказки интерфейса, те же, что у прежних блоков; каждую запись
 * проверяет сервер. Сборка без запросов: её вызывают страница и статический
 * рендер с синтетикой.
 */
export function leadWorkParts(input: LeadWorkPartsInput): Readonly<{ header: ReactNode; overview: ReactNode; actions: ReactNode }> {
  const { actor, profile, draft, sales } = input;
  const preview = isStaffPreview(actor);
  const today = dayInOrganizationTimezone(input.now);
  const leadId = sales.lead.leadId;
  const stripRead = sales.strip.status === "available" ? sales.strip.strip : null;
  const handedOff = sales.handoff.handedOffAt !== null || stripRead?.handoff != null;
  const canManage = !preview && staffHasPermission(actor, "lead.sales.workflow.manage");
  const canRegisterSale = canManage && staffHasPermission(actor, "sales.register.manage");
  const caseId = draft.admissions?.studentCaseId ?? (sales.handoff.canOpenCase ? sales.handoff.caseId : null);
  const caseHref = caseId ? `/v3/profile?case=${encodeURIComponent(caseId)}` : null;
  // Вкладка «Договор и оплата» и что на ней видно этому сотруднику — та же
  // сборка, что у адреса вкладки и полосы вкладок (`profileTabAccess`).
  const gateForms = hasHandoffGateForms(sales.gate, preview);
  const tabAccess = profileTabAccess(draft.access, {
    financeConfirm: !preview && !!sales.handoff.caseId && staffHasPermission(actor, "finance.event.confirm"),
    gateForms,
  });
  const financeVisible = !profile.student || tabAccess.finance;
  // Договор и оплата — одно место, полоса «Передача» (Э8.4): договор и платежи
  // дела (188), если прочитаны и вкладка их показывает; без них — процент
  // оплаты из финансов дела.
  const agreement = financeVisible && input.agreement?.status === "ok" ? input.agreement.agreement : null;
  const caseMoney: StripCaseMoney | null = agreement ? stripCaseMoney(agreement)
    : draft.paidPercent !== null && draft.paidPercent > 0
      ? { contractUploadedAt: null, firstPaymentOn: null, paidText: `оплачено ${draft.paidPercent}%` } : null;
  // Предупреждение полосы ведёт к действию, которое этот сотрудник может сделать; нет действия — нет предупреждения.
  const strip = stripRead ? handoffStripView(stripRead, {
    now: input.now,
    caseMoney,
    firstPayment: { amount: sales.gate.firstPaymentAmount, currency: sales.gate.firstPaymentCurrency },
    links: {
      caseHref,
      saleHref: canRegisterSale ? leadSaleHref(leadId) : null,
      assignCurator: !preview && staffHasPermission(actor, "case.curator.assign"),
    },
  }) : null;
  const primary = leadPrimaryAction({ leadId, stage: sales.lead.stageKey, handedOff, caseHref, canManageWorkflow: canManage, canRegisterSale });
  const stepEditable = canManage && !handedOff;

  // «Написать» — прежние ссылки: связанная переписка WhatsApp (право её
  // открыть — `messaging.read`) или переписка дела, если дело читается.
  const conversations = staffPresentationCan(actor, "messaging.read") ? sales.linkedConversations : [];
  const writeHref = conversations[0]
    ? buildV3InboxHref({ conversationId: conversations[0].conversationId, filters: { query: null, waitingOnly: false } })
    : draft.admissions ? `/v3/messages?case=${encodeURIComponent(draft.admissions.studentCaseId)}` : null;
  // Задача — тот же диалог «Новая задача», что у всех входов (Э7), на месте:
  // по делу (есть дело и `task.create`), иначе рабочая задача по лиду
  // (`staff.task.create`, версия процесса лида — для команды создания).
  const taskCaseId = !preview && staffPresentationCan(actor, "admissions.read") && staffHasPermission(actor, "task.create")
    ? draft.admissions?.studentCaseId ?? null : null;
  const leadTaskAllowed = !taskCaseId && !preview && staffHasPermission(actor, "staff.task.create");
  const taskLabel = taskCaseId ? "Задача по делу" : "Задача по лиду";
  const taskContext: TaskComposerPageContext | null = taskCaseId
    ? { case: { id: taskCaseId, name: profile.person } }
    : leadTaskAllowed ? { lead: { id: leadId, version: sales.lead.workflowVersion, name: profile.person } } : null;
  const closable = !preview && staffHasPermission(actor, "lead.sales.workflow.manage");

  const actions = (
    <div className="flex flex-wrap items-center gap-2" data-testid="v3-lead-actions">
      {primary?.kind === "step" ? (
        <button type="button" popoverTarget={LEAD_STEP_DRAWER_ID} aria-haspopup="dialog" className={btnCls} data-testid="v3-lead-primary">
          Записать следующий шаг
        </button>
      ) : primary?.kind === "sale" ? (
        <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
          <Link href={primary.href} className={btnCls} data-testid="v3-lead-primary">Оформить продажу</Link>
          {/* «Связать с лидом» (Э8.7): рядом с «Оформить продажу» — запись отчёта не
              заменяет продажу, только называет, что уже есть связанная запись. */}
          {strip?.linkedRecord ? (
            <a href={strip.linkedRecord.href} className="t-meta text-fg-2 underline underline-offset-4 hover:text-fg" data-testid="v3-lead-linked-record">
              <StripLine text={strip.linkedRecord.text} />
              {" · "}{strip.linkedRecord.action}
            </a>
          ) : null}
        </span>
      ) : primary?.kind === "case" ? (
        <Link href={primary.href} className={ACTION_LINK} data-testid="v3-lead-primary">Открыть дело</Link>
      ) : null}
      {writeHref ? (
        <Link href={writeHref} className={ICON_ACTION} title="Написать">
          <Icon name="message-circle" size={18} className="shrink-0" />
          <span className="sr-only sm:not-sr-only">Написать</span>
        </Link>
      ) : null}
      {taskContext ? <>
        {/* «Создать задачу» меню и Ctrl+K на этой странице — с тем же лидом или делом. */}
        <TaskComposerContextMark value={taskContext} />
        {/* Не «Создать задачу»: так называется общее действие меню в том же экране. */}
        <TaskComposerDialog
          actor={actor} actorMembershipId={actor.membershipId} day={today}
          staffAllowed={leadTaskAllowed} caseAllowed={Boolean(taskCaseId)}
          initialCase={taskContext.case ?? null}
          sourceLeadId={taskContext.lead?.id} sourceLeadVersion={taskContext.lead?.version} sourceLeadName={taskContext.lead?.name ?? null}
          triggerClassName={ICON_ACTION} triggerTitle={taskLabel} triggerTestId="v3-lead-task"
          triggerChildren={<>
            <Icon name="check-square" size={18} className="shrink-0" />
            <span className="sr-only sm:not-sr-only">{taskLabel}</span>
          </>}
        />
      </> : null}
      {/* «⋯» — только «Закрыть лид» (246); «Доступ к порталу» — своя группа в «Данных лида» (Э8.4). */}
      {closable ? (
        <LeadMoreMenu
          leadId={leadId}
          name={profile.person}
          expectedVersion={sales.lead.workflowVersion}
          blockedReason={sales.handoff.handedOffAt ? closureWords.lead.handedOff : null}
        />
      ) : null}
    </div>
  );

  // «Что дальше»: после передачи — строка передачи; до неё — действие и срок с правкой.
  const dueDate = sales.lead.nextActionText ? sales.lead.nextActionDueDate : null;
  // Срок словом (`DueWord`, Э1.3).
  const dueWord = dueDate ? dueWordOf({ dueOn: dueDate, dueAt: null }, new Date(`${today}T06:00:00.000Z`)) : null;
  const nextStep = handedOff ? (
    <p className="t-body-compact text-fg" data-testid="v3-lead-next-step">
      {strip?.summary ? <DatedText text={strip.summary} /> : "Передано в поступление"}
    </p>
  ) : (
    <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 t-body-compact text-fg" data-testid="v3-lead-next-step">
      {sales.lead.nextActionText
        ? <span className="min-w-0 break-words">{sales.lead.nextActionText}</span>
        : <span className="text-fg-2">Шаг не задан</span>}
      {dueDate ? (
        <span className="text-fg-2">
          <time dateTime={dueDate} className="font-mono tabular-nums">{leadDay(dueDate, today)}</time>
          {dueWord ? <> <DueWord view={dueWord} /></> : null}
        </span>
      ) : null}
      {stepEditable ? (
        <button type="button" popoverTarget={LEAD_STEP_DRAWER_ID} aria-haspopup="dialog" className={FACT_ACTION}>
          {sales.lead.nextActionText ? "Изменить" : "Задать шаг"}
        </button>
      ) : null}
    </p>
  );
  const trackStage = stripRead && stripRead.stage !== "closed" && stageTrack("sales", stripRead.stage) ? stripRead.stage : null;
  const header = (
    <section className="flex flex-col gap-3" data-testid="v3-lead-header" aria-label="Сведения лида">
      <dl className="grid grid-cols-1 border-y border-border sm:flex sm:flex-wrap">
        <HeaderFact term="Этап">
          {strip === null ? <span className="text-fg-2">не прочитан</span>
            : trackStage ? <StageTrack kind="sales" current={trackStage} />
              : <span data-testid="v3-lead-stage">{strip.stageTitle}</span>}
        </HeaderFact>
        <HeaderFact term="Что дальше" wide>{nextStep}</HeaderFact>
      </dl>
      {profile.financeStop ? <p className="t-body-compact font-medium text-danger">Финансовый стоп: {profile.financeStop}</p> : null}
      {stepEditable ? (
        <LeadStepDrawer
          name={profile.person}
          lead={sales.lead}
          stages={input.stages}
          ownerOptions={input.ownerOptions}
          ownerOptionsHaveMore={input.ownerOptionsHaveMore}
          actor={actor}
          requestId={input.requestIds.step}
        />
      ) : null}
    </section>
  );

  // --- Сведения ------------------------------------------------------------
  const owner = sales.lead.currentOwnerDisplayName;
  const firstNotesPage = input.notesLatestHref === null;
  const lastContact = leadLastContact(firstNotesPage ? input.notes.rows[0]?.createdAt ?? null : null, conversations);
  // «Приём дела» — только если к полосе есть что добавить: текст куратора,
  // согласованный контакт или ответ в деле. Решение само по себе уже в «Принято».
  const curatorAnswer = draft.handoffAcknowledgement;
  const answer = curatorAnswer?.current ?? draft.salesHandoffAcknowledgement?.current ?? null;
  const answerHref = curatorAnswer?.canRespond && caseHref ? caseHref : null;
  const answerFact = (curatorAnswer ?? draft.salesHandoffAcknowledgement) !== null
    && (strip === null || Boolean(answer?.clarification) || Boolean(answer?.agreedContactDate) || answerHref !== null);
  const arrivedDay = sales.leadCreatedAt ? leadDay(dayInOrganizationTimezone(new Date(sales.leadCreatedAt)), today) : null;
  const facts = (
    <aside className="@container min-w-0" aria-labelledby="lead-facts-title" data-testid="v3-lead-facts">
      <h2 id="lead-facts-title" className="t-section text-fg">Сведения</h2>
      <dl className="mt-1">
        <Fact term="Ответственный">
          {owner ? <span className="inline-flex items-center gap-2"><Initials name={owner} decorative />{owner}</span>
            : <span className="text-fg-2">не назначен</span>}
        </Fact>
        <Fact term="Источник">
          {sourceUnderLabel(profile.source) ?? "неизвестно"}
          {arrivedDay ? <span className="text-fg-2"> · с <time dateTime={sales.leadCreatedAt ?? undefined} className="font-mono tabular-nums">{arrivedDay}</time></span> : null}
        </Fact>
        <Fact term="Контакты">
          {profile.phone || profile.email ? <>
            {profile.phone ? (
              <a href={`tel:${profile.phone.replace(/[^\d+]/gu, "")}`} className="flex min-h-11 w-fit items-center gap-1.5 tabular-nums text-fg underline-offset-4 hover:underline">
                <Icon name="phone" size={16} className="shrink-0 text-fg-3" />{profile.phone}
              </a>
            ) : null}
            {profile.email ? (
              <a href={`mailto:${profile.email}`} className="flex min-h-11 w-fit max-w-full items-center break-all text-fg underline-offset-4 hover:underline">{profile.email}</a>
            ) : null}
          </> : <span className="text-fg-2">не указаны</span>}
        </Fact>
        <Fact term="Последний контакт">
          {lastContact ? <>
            <time dateTime={lastContact.at} className="font-mono tabular-nums">{leadMoment(lastContact.at, input.now)}</time>
            <span className="text-fg-2"> · {lastContact.what}</span>
          </> : <span className="text-fg-2">не записан</span>}
        </Fact>
        {conversations.length > 1 ? (
          <Fact term="Переписка">
            {conversations.map((conversation) => (
              <Link key={conversation.conversationId} className={`${QUIET_LINK} flex w-fit`}
                href={buildV3InboxHref({ conversationId: conversation.conversationId, filters: { query: null, waitingOnly: false } })}>
                {conversation.subject}
              </Link>
            ))}
          </Fact>
        ) : null}
        {answerFact ? (
          <Fact term="Приём дела">
            <HandoffResponseSummary current={answer} />
            {answerHref ? <Link href={answerHref} className={`${QUIET_LINK} flex w-fit`}>Ответить в деле</Link> : null}
          </Fact>
        ) : null}
      </dl>
    </aside>
  );

  // «Передача»: пока ни одного доказательства нет, предупреждать не о чем и
  // сноски нет — одна строка вместо пяти прочерков; первый факт — полоса.
  const handoffEmpty = strip !== null && !handedOff && strip.warnings.length === 0
    && strip.items.every((item) => item.state === "missing") && handoffFootnote(sales.gate, { now: input.now }) === null;
  // «Изменить» — на вкладку «Договор и оплата», если она есть у этого
  // сотрудника и там есть что изменить: подтверждение вручную (тогда — к
  // нему, якорем), договор и платежи дела или договорный процесс — по его
  // флагам записи; продажам процесс не рисуется (`ProfileContractWorkspace`).
  const moneyTab = tabsFor(profile.student, tabAccess, draft.admissions !== null).some((tab) => tab.key === "money");
  const agreementWritable = agreement !== null && agreement.canWrite && !preview;
  const contractWritable = !preview && actor.presentationRole !== "sales" && draft.access.contract
    && draft.contract !== null && contractWorkspaceWritable(draft.contract.workspace);
  const moneyHref = moneyTab && (gateForms || agreementWritable || contractWritable)
    ? `${input.hrefFor("money")}${gateForms ? `#${LEAD_GATE_ANCHOR}` : ""}` : null;
  const handoff = (
    <section aria-labelledby="lead-handoff-title" className="@container min-w-0 border-t border-border pt-3" data-testid="v3-lead-handoff">
      <div className="flex flex-wrap items-center gap-x-2">
        <h2 id="lead-handoff-title" className="t-item text-fg">Передача</h2>
        {handoffEmpty ? <p className="t-body-compact text-fg-2" data-testid="v3-handoff-empty">ничего не подтверждено</p> : null}
        {moneyHref ? (
          <Link href={moneyHref} className={`${QUIET_LINK} ms-auto`} data-testid="v3-handoff-edit"
            aria-label="Изменить договор и оплату">Изменить</Link>
        ) : null}
      </div>
      {handoffEmpty ? null : <HandoffStripBlock gate={sales.gate} view={strip} className="mt-1 space-y-3" summary={!handedOff} />}
    </section>
  );

  // --- Лента ---------------------------------------------------------------
  const gate = sales.gate;
  const events: LeadFeedEvent[] = [];
  if (sales.leadCreatedAt) events.push({ key: "created", at: sales.leadCreatedAt, text: `Лид создан · ${sourceWord(profile.source) ?? "источник неизвестен"}` });
  // Слова полосы «Передача»: «Договор — подтверждён вручную», «Оплата — первый платёж».
  if (gate.contractConfirmedAt) events.push({ key: "contract", at: gate.contractConfirmedAt, text: "Договор подтверждён вручную" });
  if (gate.firstPaymentConfirmedAt) events.push({ key: "payment", at: gate.firstPaymentConfirmedAt, text: "Первый платёж подтверждён вручную" });
  if (gate.overriddenAt) events.push({ key: "override", at: gate.overriddenAt, text: "Разрешено исключение из условий передачи" });
  if (stripRead?.handoff) events.push({ key: "handoff", at: stripRead.handoff.completedAt, text: "Передано в поступление" });
  if (stripRead?.curator?.assignedAt) events.push({ key: "curator", at: stripRead.curator.assignedAt, text: `Назначен куратор · ${stripRead.curator.displayName}` });
  if (stripRead?.acceptance) {
    const decision = stripRead.acceptance.decision;
    events.push({ key: "acceptance", at: stripRead.acceptance.at,
      text: decision === "accepted" ? "Куратор принял дело" : decision === "declined" ? "Куратор отклонил передачу" : "Куратор просит уточнить передачу" });
  }
  const feed = leadFeed(input.notes.rows, events, firstNotesPage);
  const notesWritable = !preview;
  const feedPart = (
    <section className="min-w-0" aria-labelledby="lead-feed-title" data-testid="v3-lead-feed">
      <h2 id="lead-feed-title" className="t-section text-fg">Лента</h2>
      <div className="mt-2 space-y-3">
        {notesWritable ? (
          <LeadNoteComposer key={`${input.notes.subject.leadId ?? ""}:${input.notes.subject.studentCaseId ?? ""}`}
            subject={input.notes.subject} requestId={input.requestIds.note} />
        ) : null}
        {input.submissions}
      </div>
      {feed.length > 0 ? (
        <ol className="mt-3 divide-y divide-border border-t border-border" data-testid="v3-lead-feed-items">
          {/* Общая разметка строк с Student 360 (`FeedRow`): одна метка, один край текста. */}
          {feed.map((item, index) => item.kind === "note" ? (
            <FeedNote key={`note:${item.at}:${index}`} body={item.note.body} author={item.note.authorDisplayName}
              at={item.at} label={leadMoment(item.at, input.now)} />
          ) : (
            <FeedEvent key={`event:${item.event.key}`} text={item.event.text} at={item.at} label={leadMoment(item.at, input.now)} />
          ))}
        </ol>
      ) : (
        <p className="mt-3 border-t border-border pt-3 t-body-compact text-fg-2">Заметок пока нет.</p>
      )}
      {input.notesOlderHref || input.notesLatestHref ? (
        <nav aria-label="Страницы заметок" className="flex flex-wrap gap-x-5 border-t border-border">
          {input.notesLatestHref ? <Link href={input.notesLatestHref} prefetch={false} className={QUIET_LINK}>К последним</Link> : null}
          {input.notesOlderHref ? <Link href={input.notesOlderHref} prefetch={false} className={QUIET_LINK}>Ранее</Link> : null}
        </nav>
      ) : null}
    </section>
  );

  // --- Группы правки -------------------------------------------------------
  const conditions = draft.saleConditions;
  const summaries = conditions ? leadGroupSummaries(conditions) : null;
  const conditionsReadOnly = preview || !staffHasPermission(actor, "lead.sales.workflow.manage");
  const portalControls = !preview && profile.student && draft.admissions
    && (actor.systemRole === "admin" || (draft.admissions.isCabinetCase && staffCan(actor, "sales.write"))) ? (
      <StudentPortalAccessControls
        organizationId={actor.organizationId}
        studentCaseId={draft.admissions.studentCaseId}
        email={profile.email}
        displayName={profile.person}
        caseState={draft.admissions.caseState}
        isCabinetCase={draft.admissions.isCabinetCase}
        requestId={input.requestIds.portal}
        curatorOptions={input.curators}
        curatorOptionsAvailable={input.curatorsAvailable}
        quiet
      />
    ) : !preview && !draft.admissions && draft.leadCabinetCase?.cabinetInvite ? (
      // Решение владельца C (миграция 248): ожидающий кабинет лида —
      // приглашение отсюда же, у Sales с правом на этот лид.
      <StudentPortalAccessControls
        organizationId={actor.organizationId}
        studentCaseId={draft.leadCabinetCase.studentCaseId}
        email={profile.email}
        displayName={profile.person}
        caseState="pending"
        isCabinetCase
        requestId={input.requestIds.cabinetPortal}
        curatorOptions={[]}
        curatorOptionsAvailable
        quiet
      />
    ) : null;
  const groups = (
    <section className="@container min-w-0" aria-labelledby="lead-edit-title" data-testid="v3-lead-edit">
      <h2 id="lead-edit-title" className="t-section text-fg">Данные лида</h2>
      <LeadEditGroups>
        {conditions && summaries ? (
          <SaleConditionsRevisionProvider initialRevision={conditions.revision}>
            <EditGroup id="sale-conditions" title="Условия продажи" summary={summaries.sale} testId="v3-lead-group-sale">
              <LeadSaleConditions leadId={conditions.leadId} conditions={conditions} requestId={input.requestIds.saleConditions}
                readOnly={conditionsReadOnly} quiet bare />
            </EditGroup>
            <EditGroup title="Пожелания" summary={summaries.wishes} testId="v3-lead-group-wishes">
              <LeadWishesCard leadId={conditions.leadId} conditions={conditions} requestId={input.requestIds.wishesCard}
                readOnly={conditionsReadOnly} quiet bare />
            </EditGroup>
            <EditGroup title="Образование" summary={summaries.education} testId="v3-lead-group-education">
              <LeadEducationCard leadId={conditions.leadId} conditions={conditions} requestId={input.requestIds.educationCard}
                readOnly={conditionsReadOnly} quiet bare />
            </EditGroup>
            <EditGroup title="Бюджет и ограничения" summary={summaries.conditions} testId="v3-lead-group-conditions">
              <LeadConditionsCard leadId={conditions.leadId} conditions={conditions} requestId={input.requestIds.conditionsCard}
                readOnly={conditionsReadOnly} quiet bare />
            </EditGroup>
          </SaleConditionsRevisionProvider>
        ) : null}
        <EditGroup id={LEAD_PORTAL_GROUP_ID} title="Доступ к порталу" summary={portalSummary(draft)} testId="v3-lead-group-portal">
          <PlatformAccessCard
            application={draft.studentApplication}
            requestId={input.requestIds.platformAccess}
            readOnly={preview}
            leadId={leadId}
            leadCabinetCase={draft.admissions ? { studentCaseId: draft.admissions.studentCaseId, state: draft.admissions.caseState } : draft.leadCabinetCase}
            prepareRequestId={input.requestIds.prepareLeadCabinet}
            caseLink={staffPresentationCan(actor, "admissions.read")}
            bare
          >
            {portalControls}
          </PlatformAccessCard>
        </EditGroup>
      </LeadEditGroups>
    </section>
  );

  // Как «Обзор» дела (Э8.4): порядок чтения и телефона — «Сведения», «Передача»,
  // лента с заметкой, группы правки. От 1280 px справа за волосяной линией во
  // весь рост — только факты; слева рабочая колонка — лента и под ней группы
  // во всю её ширину (в колонке «Сведений» формы тесны).
  const overview = (
    <div className="grid gap-x-8 gap-y-8 xl:grid-cols-[minmax(0,1fr)_22rem]" data-testid="v3-lead-overview">
      <div className="flex min-w-0 flex-col gap-6 xl:col-start-2 xl:row-start-1 xl:border-s xl:border-border xl:ps-6" data-testid="v3-lead-side">
        {facts}
        {handoff}
      </div>
      <div className="flex min-w-0 flex-col gap-8 xl:col-start-1 xl:row-start-1">
        {feedPart}
        {groups}
      </div>
    </div>
  );

  return { header, overview, actions };
}
