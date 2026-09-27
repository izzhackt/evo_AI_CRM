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
import { closureWords, source as sourceWord } from "@/lib/v3/wording";

import { DueWord } from "../blocks/DueWord";
import { Initials } from "../blocks/Initials";
import { isNextLook, type V3Look } from "../blocks/look";
import { StageTrack } from "../blocks/StageTrack";
import { dueWordOf } from "../queue/due-bucket";
import { handoffStripView, stripMoment, type StripText } from "./handoff-strip-view";
import { LeadConditionsCard, LeadEducationCard, LeadWishesCard, SaleConditionsRevisionProvider } from "./LeadCardFieldsForm";
import { LeadEditGroups, LeadMoreMenu } from "./LeadEditGroups";
import { LeadNoteComposer } from "./LeadNoteComposer";
import { LeadSaleConditions } from "./LeadSaleConditions";
import { LeadStepDrawer } from "./LeadStepDrawer";
import { HandoffGateForms, HandoffResponseSummary, HandoffStripBlock } from "./ProfileSalesTransition";
import { StudentPortalAccessControls } from "./StudentPortalAccessCard";
import { PlatformAccessCard } from "./tabs";
import {
  LEAD_PORTAL_GROUP_ID,
  LEAD_STEP_DRAWER_ID,
  handoffGateForms,
  leadDay,
  leadDueState,
  leadFeed,
  leadGroupSummaries,
  leadLastContact,
  leadMoment,
  leadPrimaryAction,
  type LeadFeedEvent,
} from "./lead-work-view";
import type { PersonProfile, ProfileDraft, ProfileNotesSnapshot, ProfileSalesRequestIds, ProfileSalesSnapshot } from "./types";

/** Переход, который выглядит как спокойная кнопка: 44 px, рамка контрола, без красного. */
const ACTION_LINK = "inline-flex min-h-11 items-center gap-1.5 rounded-ctl border border-control-edge bg-surface px-3 t-label text-fg-2 hover:bg-surface-2 hover:text-fg";
/** Текстовая кнопка факта: 44 px по высоте, подчёркнута — без красного она остаётся действием. */
const FACT_ACTION = "inline-flex min-h-11 items-center t-label text-fg-2 underline underline-offset-4 hover:text-fg";
const QUIET_LINK = "inline-flex min-h-11 items-center t-label text-fg-2 underline underline-offset-4 hover:text-fg";

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
  /** «Заявки с сайта» — своё чтение (`WebsiteLeadSubmissions`); null — не показываются. */
  submissions: ReactNode;
  hrefFor: (tab: string) => string;
  now: Date;
  /** Новый облик (Э1.3–Э1.4): дорожка этапа, срок словом, инициалы. */
  look?: V3Look;
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
        <span className="shrink-0 t-item text-fg">{title}</span>
        <span className={`min-w-0 flex-1 truncate t-meta ${summary ? "text-fg-2" : "text-fg-3"}`} title={shown}>{shown}</span>
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
 *   (`leadPrimaryAction`), «Написать», «Создать задачу» и «⋯»;
 * - `header` — над вкладками: этап (слова доски; дорожка — в новом облике) и
 *   «Что дальше» с правкой прежней формой решения доски в выдвижной панели;
 * - `overview` — «Обзор»: от 1280 px слева лента (заметки и события) с
 *   заметкой в одну строку, справа «Сведения» с полосой «Передача» и
 *   свёрнутые группы правки — по одной, «Сохранить» спокойное.
 *
 * Права — подсказки интерфейса, те же, что у прежних блоков; каждую запись
 * проверяет сервер. Сборка без запросов: её вызывают страница и статический
 * рендер с синтетикой.
 */
export function leadWorkParts(input: LeadWorkPartsInput): Readonly<{ header: ReactNode; overview: ReactNode; actions: ReactNode }> {
  const { actor, profile, draft, sales } = input;
  const preview = isStaffPreview(actor);
  const next = isNextLook(input.look);
  const today = dayInOrganizationTimezone(input.now);
  const leadId = sales.lead.leadId;
  const stripRead = sales.strip.status === "available" ? sales.strip.strip : null;
  const strip = stripRead ? handoffStripView(stripRead, { now: input.now }) : null;
  const handedOff = sales.handoff.handedOffAt !== null || stripRead?.handoff != null;
  const canManage = !preview && staffHasPermission(actor, "lead.sales.workflow.manage");
  const canRegisterSale = canManage && staffHasPermission(actor, "sales.register.manage");
  const caseId = draft.admissions?.studentCaseId ?? (sales.handoff.canOpenCase ? sales.handoff.caseId : null);
  const caseHref = caseId ? `/v3/profile?case=${encodeURIComponent(caseId)}` : null;
  const primary = leadPrimaryAction({ leadId, stage: sales.lead.stageKey, handedOff, caseHref, canManageWorkflow: canManage, canRegisterSale });
  const stepEditable = canManage && !handedOff;

  // «Написать» — прежние ссылки: связанная переписка WhatsApp (право её
  // открыть — `messaging.read`) или переписка дела, если дело читается.
  const conversations = staffPresentationCan(actor, "messaging.read") ? sales.linkedConversations : [];
  const writeHref = conversations[0]
    ? buildV3InboxHref({ conversationId: conversations[0].conversationId, filters: { query: null, waitingOnly: false } })
    : draft.admissions ? `/v3/messages?case=${encodeURIComponent(draft.admissions.studentCaseId)}` : null;
  // «Создать задачу» — задача по делу (есть дело и право), иначе задача сотрудника по лиду, как в панели доски.
  const taskCaseId = !preview && staffHasPermission(actor, "task.manage") ? draft.admissions?.studentCaseId ?? null : null;
  const taskHref = taskCaseId
    ? `/v3/tasks?create=case&case=${encodeURIComponent(taskCaseId)}`
    : !preview && staffHasPermission(actor, "staff.task.read") ? `/v3/tasks?lead=${encodeURIComponent(leadId)}&create=staff` : null;
  const closable = !preview && staffHasPermission(actor, "lead.sales.workflow.manage");

  const actions = (
    <div className="flex flex-wrap items-center gap-2" data-testid="v3-lead-actions">
      {primary?.kind === "step" ? (
        <button type="button" popoverTarget={LEAD_STEP_DRAWER_ID} aria-haspopup="dialog" className={btnCls} data-testid="v3-lead-primary">
          Записать следующий шаг
        </button>
      ) : primary?.kind === "sale" ? (
        <Link href={primary.href} className={btnCls} data-testid="v3-lead-primary">Оформить продажу</Link>
      ) : primary?.kind === "case" ? (
        <Link href={primary.href} className={ACTION_LINK} data-testid="v3-lead-primary">Открыть дело</Link>
      ) : null}
      {writeHref ? (
        <Link href={writeHref} className={ACTION_LINK}>
          <Icon name="message-circle" size={18} className="shrink-0" />
          Написать
        </Link>
      ) : null}
      {taskHref ? (
        <Link href={taskHref} className={ACTION_LINK}>
          <Icon name="check-square" size={18} className="shrink-0" />
          Создать задачу
        </Link>
      ) : null}
      <LeadMoreMenu
        leadId={leadId}
        name={profile.person}
        expectedVersion={sales.lead.workflowVersion}
        blockedReason={sales.handoff.handedOffAt ? closureWords.lead.handedOff : null}
        closable={closable}
        portalGroupId={LEAD_PORTAL_GROUP_ID}
        portalHref={`${input.hrefFor("overview")}#${LEAD_PORTAL_GROUP_ID}`}
      />
    </div>
  );

  // «Что дальше»: после передачи — строка передачи; до неё — действие и срок с правкой.
  const dueDate = sales.lead.nextActionText ? sales.lead.nextActionDueDate : null;
  const dueState = leadDueState(dueDate, today);
  const dueWord = next && dueDate ? dueWordOf({ dueOn: dueDate, dueAt: null }, new Date(`${today}T06:00:00.000Z`)) : null;
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
        <span className={dueState === "overdue" && !next ? "text-danger" : "text-fg-2"}>
          <time dateTime={dueDate} className="font-mono tabular-nums">{leadDay(dueDate, today)}</time>
          {dueWord ? <> <DueWord view={dueWord} /></>
            : dueState === "overdue" ? " прошёл"
              : dueState === "today" ? <span className="text-warn"> сегодня</span> : null}
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
            : next && trackStage ? <StageTrack kind="sales" current={trackStage} />
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
  const acknowledgement = draft.salesHandoffAcknowledgement;
  const curatorAnswer = draft.handoffAcknowledgement;
  const facts = (
    <aside className="@container min-w-0 xl:col-start-2 xl:row-start-1" aria-labelledby="lead-facts-title" data-testid="v3-lead-facts">
      <h2 id="lead-facts-title" className="t-section text-fg">Сведения</h2>
      <dl className="mt-1">
        <Fact term="Ответственный">
          {owner ? (next ? <span className="inline-flex items-center gap-2"><Initials name={owner} decorative />{owner}</span> : owner)
            : <span className="text-fg-2">не назначен</span>}
        </Fact>
        <Fact term="Источник">
          {sourceWord(profile.source) ?? "неизвестно"}
          {profile.arrived ? <span className="text-fg-2"> · с <span className="font-mono tabular-nums">{profile.arrived}</span></span> : null}
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
        {curatorAnswer ? (
          <Fact term="Приём дела">
            <HandoffResponseSummary current={curatorAnswer.current} />
            {curatorAnswer.canRespond && caseHref ? <Link href={caseHref} className={`${QUIET_LINK} flex w-fit`}>Ответить в деле</Link> : null}
          </Fact>
        ) : acknowledgement ? (
          <Fact term="Приём дела"><HandoffResponseSummary current={acknowledgement.current} /></Fact>
        ) : null}
        {draft.paidPercent !== null ? (
          <Fact term="Оплата">
            <span className="font-semibold tabular-nums">{draft.paidPercent}%</span> оплачено
            {draft.remaining ? <span className="text-fg-2"> · остаток <span className="tabular-nums">{draft.remaining}</span></span> : null}
          </Fact>
        ) : null}
      </dl>
      <section aria-labelledby="lead-handoff-title" className="mt-4 border-t border-border pt-3">
        <h3 id="lead-handoff-title" className="t-item text-fg">Передача</h3>
        <HandoffStripBlock gate={sales.gate} view={strip} className="mt-1 space-y-3" summary={!handedOff} />
      </section>
    </aside>
  );

  // --- Лента ---------------------------------------------------------------
  const gate = sales.gate;
  const events: LeadFeedEvent[] = [];
  if (sales.leadCreatedAt) events.push({ key: "created", at: sales.leadCreatedAt, text: `Лид создан · ${sourceWord(profile.source) ?? "источник неизвестен"}` });
  if (gate.contractConfirmedAt) events.push({ key: "contract", at: gate.contractConfirmedAt, text: "Договор подтверждён" });
  if (gate.firstPaymentConfirmedAt) events.push({ key: "payment", at: gate.firstPaymentConfirmedAt, text: "Первый платёж подтверждён" });
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
    <section className="min-w-0 xl:col-start-1 xl:row-span-2 xl:row-start-1" aria-labelledby="lead-feed-title" data-testid="v3-lead-feed">
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
          {feed.map((item, index) => item.kind === "note" ? (
            <li key={`note:${item.at}:${index}`} className="py-3" data-feed="note">
              <p className="whitespace-pre-wrap break-words t-body text-fg">{item.note.body}</p>
              <p className="t-meta mt-1 text-fg-2">
                {item.note.authorDisplayName}
                {" · "}
                <time dateTime={item.at} className="font-mono tabular-nums">{leadMoment(item.at, input.now)}</time>
              </p>
            </li>
          ) : (
            <li key={`event:${item.event.key}`} className="flex min-h-11 flex-wrap items-baseline gap-x-2 py-2.5 t-body-compact text-fg-2" data-feed="event">
              <Icon name="circle" size={10} className="shrink-0 self-center text-fg-3" />
              <span className="min-w-0 flex-1 break-words">{item.event.text}</span>
              <time dateTime={item.at} className="font-mono tabular-nums t-meta">{leadMoment(item.at, input.now)}</time>
            </li>
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
  const gateForms = handoffGateForms(gate, preview);
  const hasGateForms = gateForms.contract || gateForms.payment || gateForms.override;
  const gateSummary = [
    gate.contractConfirmedAt ? `договор подтверждён ${stripMoment(gate.contractConfirmedAt, today)}` : "договор не подтверждён",
    gate.firstPaymentReceivedDate ? `платёж получен ${leadDay(gate.firstPaymentReceivedDate, today)}` : null,
  ].filter(Boolean).join(" · ");
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
    <section className="@container min-w-0 xl:col-start-2 xl:row-start-2" aria-labelledby="lead-edit-title" data-testid="v3-lead-edit">
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
            <EditGroup title="Условия" summary={summaries.conditions} testId="v3-lead-group-conditions">
              <LeadConditionsCard leadId={conditions.leadId} conditions={conditions} requestId={input.requestIds.conditionsCard}
                readOnly={conditionsReadOnly} quiet bare />
            </EditGroup>
          </SaleConditionsRevisionProvider>
        ) : null}
        {hasGateForms ? (
          <EditGroup title="Договор и оплата" summary={gateSummary} testId="v3-lead-group-contract">
            <HandoffGateForms actor={actor} gate={gate} requestIds={input.requestIds} bare />
          </EditGroup>
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

  const overview = (
    <div className="grid gap-x-8 gap-y-8 xl:grid-cols-[minmax(0,1fr)_22rem] xl:grid-rows-[auto_1fr]" data-testid="v3-lead-overview">
      {facts}
      {feedPart}
      {groups}
    </div>
  );

  return { header, overview, actions };
}
