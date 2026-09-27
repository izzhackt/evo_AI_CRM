import Link from "next/link";
import type { ReactNode } from "react";

import type { HandoffAcknowledgement } from "@/lib/platform-handoff-acknowledgement";
import type { AdmissionsDirection } from "@/lib/platform-admissions-playbook-contract";
import type { StudentCaseChecklistCounts } from "@/lib/platform-student-case-queue-contract";
import { applicationStatus, caseChatAwaitState } from "@/lib/v3/wording";

import { Icon } from "@/components/icons";

import { Pill } from "../Pill";
import { formatQueueDay } from "../queue/due-bucket";
import { studentsDocumentsLine, studentsHandoffPending } from "../students/students-queue-view";
import { Initials } from "../blocks/Initials";
import { isNextLook, type V3Look } from "../blocks/look";
import { ProgressBar } from "../blocks/ProgressBar";
import { StatusChip } from "../blocks/StatusChip";
import type { TaskRowPermissions } from "../tasks/TaskQueueRow";
import { DIRECTION_LABELS } from "./admissions-view";
import { CaseHandoffBlock } from "./CaseHandoffBlock";
import { CaseTaskList } from "./CaseTaskList";
import { LeadEditGroups } from "./LeadEditGroups";
import { HandoffResponseSummary } from "./ProfileSalesTransition";
import { FeedMore } from "./FeedMore";
import { FEED_LINK, FeedChat, FeedEvent, FeedNote, FeedPointer } from "./FeedRow";
import {
  CASE_FACTS_ID,
  CASE_FEED_SHOWN,
  CASE_PORTAL_GROUP_ID,
  CASE_SALES_GROUP_ID,
  caseMomentLabel,
  type CaseApplicationLine,
  type CaseFeedItem,
  type CaseWorkRead,
} from "./case-work-view";
import { COVERAGE_VIEW_HREF, coverageHref } from "./students-coverage-view";

const LINK = "inline-flex min-h-11 items-center t-label text-fg-2 underline underline-offset-4 hover:text-fg";
/** Ссылка факта своей строкой под значением (блочная, 44 px): не прилипает к тексту значения. */
const FACT_LINK = "flex min-h-11 w-fit items-center t-label text-fg-2 underline underline-offset-4 hover:text-fg";
const TONE = { danger: "text-danger", warn: "text-warn", muted: "text-fg-2" } as const;
/** Раскрытие «Изменить ответ» в «Сведениях»: подпись-действие без маркера, 44 px. */
const SUMMARY = "flex min-h-11 w-fit cursor-pointer list-none items-center t-label text-fg-2 underline underline-offset-4 hover:text-fg [&::-webkit-details-marker]:hidden";

export type CaseOverviewInput = Readonly<{
  studentCaseId: string;
  work: CaseWorkRead;
  /** Снимок «Приёма дела»: ответ куратора — в «Сведениях»; ждущий ответа — главное действие у заголовка. */
  handoff: (HandoffAcknowledgement & Readonly<{ requestId: string }>) | null;
  taskPermissions: TaskRowPermissions;
  /** null — нет права читать документы дела (нет чтения — нет числа). */
  documents: StudentCaseChecklistCounts | null;
  applications: readonly CaseApplicationLine[];
  /** null — оплаты в этом деле этому сотруднику не видно. */
  payment: Readonly<{ percent: number | null; remaining: string | null; financeStop: string | null }> | null;
  contacts: Readonly<{ phone: string | null; email: string | null }>;
  direction: AdmissionsDirection | null;
  /** Куратор дела: имя из дела, id — из строки очереди (для «Нагрузки кураторов»). */
  curator: Readonly<{ name: string | null; membershipId: string | null; coverage: boolean }>;
  /** Кто и когда передал дело (контекст передачи); null — дело не из продаж. */
  handedOffBy: Readonly<{ name: string; at: string }> | null;
  /** «Доступ к порталу»: состояние словом и прежние формы в группе; null — строки нет. */
  portal: Readonly<{ text: string; tone: "muted" | "warn" | "ok"; settings: ReactNode }> | null;
  /** Продажа в «Сведениях»; null — у сотрудника нет чтения продаж. */
  sales: Readonly<{ manager: string | null; nextAction: string | null }> | null;
  /** Формы продажи — свёрнутая группа «Данные продажи»; null — группы нет. */
  salesData: ReactNode;
  salesDataOpen: boolean;
  help: ReactNode;
  /** Лента (`caseFeed`) и заметка в одну строку; null — писать заметки нельзя (просмотр роли). */
  feed: Readonly<{ items: readonly CaseFeedItem[]; eventsUnavailable: boolean }>;
  noteComposer: ReactNode;
  notesOlderHref: string | null;
  notesLatestHref: string | null;
  hrefs: Readonly<{ documents: string | null; route: string | null; money: string | null; messages: string; history: string }>;
  /** Новый облик (Э1.3): блоки в строках задач, инициалы куратора и полоса документов из прочитанных чисел. */
  look?: V3Look;
}>;

/** Факт «Сведений»: строка на волосяной линии. */
function Fact({ term, children, testId }: Readonly<{ term: string; children: ReactNode; testId?: string }>) {
  return (
    <div className="min-w-0 border-b border-border py-2.5 last:border-b-0" data-testid={testId}>
      <dt className="t-caption text-fg-2">{term}</dt>
      <dd className="mt-0.5 min-w-0 break-words t-body-compact text-fg">{children}</dd>
    </div>
  );
}

/**
 * Группа правки: одна строка — название и состояние, раскрытие — прежние
 * формы без своей карточки (как у Lead 360). `name` у групп один: открыта одна.
 */
function Group({ id, title, summary, open, testId, children }: Readonly<{
  id: string; title: string; summary: ReactNode; open?: boolean; testId: string; children: ReactNode;
}>) {
  return (
    <details name="case-edit" id={id} open={open} data-lead-group="" data-testid={testId} className="group scroll-mt-4 border-b border-border">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 rounded-nav py-1.5 [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3">
          <span className="t-item text-fg">{title}</span>
          <span className="min-w-28 flex-1 t-meta text-fg-2">{summary}</span>
        </span>
        <Icon name="chevron-down" size={18} className="shrink-0 text-fg-3 transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      <div className="pb-4 pt-1">{children}</div>
    </details>
  );
}

function Tasks({ input }: Readonly<{ input: CaseOverviewInput }>) {
  const { work } = input;
  return (
    // `#case-tasks` — адрес «Все задачи дела» из «Быстрого просмотра» (#1059).
    <section id="case-tasks" aria-labelledby="case-tasks-title" className="min-w-0 scroll-mt-4 space-y-3" data-testid="v3-case-tasks-part">
      <h2 id="case-tasks-title" tabIndex={-1} data-queue-heading="" className="t-section text-fg">Задачи</h2>
      {work.tasks.kind === "unavailable" ? (
        <p role="alert" className="t-body-compact text-danger">Не удалось загрузить задачи. Обновите страницу, чтобы повторить.</p>
      ) : work.tasks.tasks.length === 0 ? (
        <p className="t-body-compact text-fg-2">Открытых задач нет.</p>
      ) : (
        <CaseTaskList tasks={work.tasks.tasks} permissions={input.taskPermissions} nowIso={work.nowIso} look={input.look} />
      )}
    </section>
  );
}

function DocumentsFact({ input }: Readonly<{ input: CaseOverviewInput }>) {
  const line = studentsDocumentsLine(input.documents);
  return (
    <Fact term="Документы" testId="v3-case-documents">
      {line && isNextLook(input.look) ? (
        // Новый облик: «N из M принято» полосой — только из прочитанных чисел; пустой чек-лист
        // или числа, которые не сходятся, — прежняя строка без полосы.
        <div className="space-y-2">
          <ProgressBar done={input.documents?.approved} total={input.documents?.total} word="принято"
            fallback={<p className="t-body-compact text-fg">{line.summary}</p>} />
          {line.parts.length ? (
            <p className="flex flex-wrap gap-1">
              {line.parts.map((part) => <StatusChip key={part.key} label={part.text} tone={part.tone === "warn" ? "warn" : part.tone === "danger" ? "danger" : "neutral"} />)}
            </p>
          ) : null}
        </div>
      ) : line ? (
        <p>
          {line.summary}
          {line.parts.map((part) => <span key={part.key}><span className="text-fg-3"> · </span><span className={`font-medium ${TONE[part.tone]}`}>{part.text}</span></span>)}
        </p>
      ) : <span className="text-fg-2">нет доступа</span>}
      {input.hrefs.documents ? <Link href={input.hrefs.documents} className={FACT_LINK}>Документы дела</Link> : null}
    </Fact>
  );
}

function ApplicationsFact({ input }: Readonly<{ input: CaseOverviewInput }>) {
  return (
    <Fact term="Заявки" testId="v3-case-applications">
      {input.applications.length === 0 ? <span className="text-fg-2">пока нет</span> : (
        <ul className="divide-y divide-border">
          {input.applications.map((application) => (
            <li key={application.id} className="py-1 first:pt-0">
              <span className="break-words font-medium text-fg">{application.title}</span>
              <span className="text-fg-2">
                {" — "}{applicationStatus(application.status) ?? "статус не указан"}
                {application.primary ? " · основной вариант" : null}
                {application.deadlineOn ? <> · дедлайн <time dateTime={application.deadlineOn} className="font-mono tabular-nums">{formatQueueDay(application.deadlineOn, input.work.today)}</time></> : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      {input.hrefs.route ? <Link href={input.hrefs.route} className={FACT_LINK}>Вузы и программы</Link> : null}
    </Fact>
  );
}

function ChatFact({ input }: Readonly<{ input: CaseOverviewInput }>) {
  const chat = input.work.chat;
  return (
    <Fact term="Переписка" testId="v3-case-chat">
      <span className="flex flex-wrap items-center gap-x-3">
        {chat.kind === "forbidden" ? <span className="text-fg-2">нет доступа</span>
          : chat.kind === "unavailable" ? <span className="text-fg-2">не прочитана</span>
            : chat.awaitState === "needs_reply" ? <Pill tone="danger">{caseChatAwaitState("needs_reply")}</Pill>
              : chat.awaitState === "awaiting_student" ? <Pill>{caseChatAwaitState("awaiting_student")}</Pill>
                : <span className="text-fg-2">{chat.last === null ? "сообщений пока нет" : "ответа не ждёт"}</span>}
        {chat.kind !== "forbidden" ? <Link href={input.hrefs.messages} className={LINK}>Открыть переписку</Link> : null}
      </span>
    </Fact>
  );
}

/**
 * «Сведения» справа от 1280 px (на телефоне — после работы): направление,
 * куратор, кто передал, продажа, контакты, приём дела, документы, заявки,
 * переписка, оплата — всё из уже прочитанных данных; нет чтения — нет числа.
 */
function Facts({ input }: Readonly<{ input: CaseOverviewInput }>) {
  const next = isNextLook(input.look);
  const handoff = input.handoff;
  const answered = handoff !== null && handoff.assignmentEventId !== null && !studentsHandoffPending(handoff);
  // Куратор ответил «Нужно уточнить» или «Отклонить», а дело всё ещё ждёт приёма: ответ виден и
  // на странице, не только в панели «Принять дело» (изменить его — там же, у заголовка).
  const onRecord = answered || (handoff !== null && handoff.assignmentEventId !== null && handoff.current !== null);
  const { curator } = input;
  const payment = input.payment;
  return (
    // `#case-facts` — цель событий куратора и передачи в ленте.
    <aside id={CASE_FACTS_ID} aria-labelledby="case-facts-title" className="min-w-0 scroll-mt-4" data-testid="v3-case-facts">
      <h2 id="case-facts-title" className="t-section text-fg">Сведения</h2>
      <dl className="mt-1">
        <Fact term="Направление">{input.direction ? DIRECTION_LABELS[input.direction] : "Не выбрано"}</Fact>
        <Fact term="Куратор">
          {(next && curator.name ? (
            <span className="inline-flex items-center gap-2"><Initials name={curator.name} decorative />{curator.name}</span>
          ) : curator.name) ?? (input.work.needsCurator ? <span className="font-medium text-danger">нужен куратор</span> : <span className="text-fg-2">не назначен</span>)}
          {curator.coverage && !input.work.needsCurator ? (
            <Link href={curator.membershipId ? coverageHref(curator.membershipId, input.studentCaseId) : COVERAGE_VIEW_HREF}
              className={FACT_LINK}>
              Нагрузка кураторов
            </Link>
          ) : null}
        </Fact>
        {input.handedOffBy ? (
          <Fact term="Передал">
            {input.handedOffBy.name}
            <span className="text-fg-2"> · <time dateTime={input.handedOffBy.at} className="font-mono tabular-nums">{caseMomentLabel(input.handedOffBy.at, input.work.today)}</time></span>
          </Fact>
        ) : null}
        {input.sales ? (
          <Fact term="Продажа">
            <span className="block">{input.sales.manager ?? "Менеджер не назначен"}</span>
            {input.sales.nextAction ? <span className="block text-fg-2">{input.sales.nextAction}</span> : null}
          </Fact>
        ) : null}
        {input.contacts.phone || input.contacts.email ? (
          <Fact term="Контакты">
            {input.contacts.phone ? (
              <a href={`tel:${input.contacts.phone.replace(/[^\d+]/gu, "")}`} className="flex min-h-11 w-fit items-center gap-1.5 tabular-nums text-fg underline-offset-4 hover:underline">
                <Icon name="phone" size={16} className="shrink-0 text-fg-3" />{input.contacts.phone}
              </a>
            ) : null}
            {input.contacts.email ? (
              <a href={`mailto:${input.contacts.email}`} className="flex min-h-11 w-fit max-w-full items-center break-all text-fg underline-offset-4 hover:underline">{input.contacts.email}</a>
            ) : null}
          </Fact>
        ) : null}
        {onRecord && handoff ? (
          <Fact term="Приём дела">
            {/* Как прежняя карточка «Приём дела»: решение, текст куратора (уточнение или причина отказа)
                и согласованный контакт — их видят и те, кто ответить не может (Admin, Admissions Manager). */}
            <HandoffResponseSummary current={handoff.current ? {
              decision: handoff.current.decision,
              clarification: handoff.current.clarification,
              agreedContactDate: handoff.current.agreedContactDate,
            } : null} />
            {answered && handoff.canRespond ? (
              <details>
                <summary className={SUMMARY}>Изменить ответ</summary>
                <div className="mt-1"><CaseHandoffBlock snapshot={handoff} headingId="case-tasks-title" /></div>
              </details>
            ) : null}
          </Fact>
        ) : null}
        <DocumentsFact input={input} />
        <ApplicationsFact input={input} />
        <ChatFact input={input} />
        {payment ? (
          <Fact term="Оплата" testId="v3-case-payment">
            {payment.percent === null ? <span className="text-fg-2">Плана платежей нет</span> : (
              <><span className="font-semibold tabular-nums">{payment.percent}%</span> оплачено{payment.remaining ? <span className="text-fg-2"> · остаток <span className="tabular-nums">{payment.remaining}</span></span> : null}</>
            )}
            {payment.financeStop ? <span className="block text-danger">Финансовый стоп: {payment.financeStop}</span> : null}
            {input.hrefs.money ? <Link href={input.hrefs.money} className={FACT_LINK}>Договор и оплата</Link> : null}
          </Fact>
        ) : null}
        {input.portal && !input.portal.settings ? (
          <Fact term="Портал" testId="v3-case-portal">{input.portal.text}</Fact>
        ) : null}
      </dl>
    </aside>
  );
}

/**
 * Группы правки под лентой: «Доступ к порталу» и «Данные продажи» — прежние
 * формы шириной рабочей колонки (в колонке «Сведений» формы продажи тесны);
 * null — групп нет.
 */
function Groups({ input }: Readonly<{ input: CaseOverviewInput }>) {
  const portal = input.portal?.settings ? input.portal : null;
  if (!portal && !input.salesData) return null;
  return (
    <div className="min-w-0 border-t border-border" data-testid="v3-case-groups">
      <LeadEditGroups>
        {portal ? (
          <Group id={CASE_PORTAL_GROUP_ID} title="Доступ к порталу" testId="v3-case-portal"
            summary={<span className={portal.tone === "warn" ? "text-warn" : portal.tone === "ok" ? "text-fg" : "text-fg-2"}>{portal.text}</span>}>
            {portal.settings}
          </Group>
        ) : null}
        {input.salesData ? (
          <Group id={CASE_SALES_GROUP_ID} title="Данные продажи" open={input.salesDataOpen} testId="v3-case-sales-data"
            summary={input.sales?.manager ?? "менеджер не назначен"}>
            <div className="flex flex-col gap-4">{input.salesData}</div>
          </Group>
        ) : null}
      </LeadEditGroups>
    </div>
  );
}

/** Строка ленты — общая разметка Lead 360 (`FeedRow`): одна метка в одной колонке, текст — от одного края. */
function FeedItem({ item, today, historyHref, focusTarget = false }: Readonly<{ item: CaseFeedItem; today: string; historyHref: string; focusTarget?: boolean }>) {
  const label = caseMomentLabel(item.at, today);
  if (item.kind === "older") {
    return (
      <FeedPointer focusTarget={focusTarget}>
        Более ранние события журнала дела — во вкладке{" "}
        <Link href={historyHref} className={FEED_LINK}>«История»</Link>
      </FeedPointer>
    );
  }
  if (item.kind === "note") {
    return <FeedNote body={item.note.body} author={item.note.authorDisplayName} at={item.at} label={label} focusTarget={focusTarget} />;
  }
  if (item.kind === "chat") {
    return <FeedChat author={item.author} text={item.text} at={item.at} label={label} href={item.href} focusTarget={focusTarget} />;
  }
  return <FeedEvent text={item.text} at={item.at} label={label} href={item.href} focusTarget={focusTarget} />;
}

/**
 * «Лента» — вниз по странице: заметка в одну строку, затем заметки и события
 * из уже прочитанного (`caseFeed`), новые сверху; страницы заметок — «Ранее»
 * и «К последним». Срез журнала дела — строка со ссылкой на «Историю».
 */
function Feed({ input }: Readonly<{ input: CaseOverviewInput }>) {
  const { items, eventsUnavailable } = input.feed;
  const key = (item: CaseFeedItem, index: number) => item.kind === "event" ? item.key : `${item.kind}:${item.at}:${index}`;
  const shown = items.slice(0, CASE_FEED_SHOWN);
  const rest = items.slice(CASE_FEED_SHOWN);
  return (
    <section id="case-feed" aria-labelledby="case-feed-title" className="min-w-0" data-testid="v3-case-feed">
      <h2 id="case-feed-title" className="t-section text-fg">Лента</h2>
      {input.noteComposer ? <div className="mt-2">{input.noteComposer}</div> : null}
      {eventsUnavailable ? (
        <p className="mt-2 t-body-compact text-fg-2" data-testid="v3-case-feed-unread">События журнала дела сейчас не прочитаны. Обновите страницу, чтобы повторить.</p>
      ) : null}
      {items.length > 0 ? (<>
        <ol className="mt-3 divide-y divide-border border-y border-border" data-testid="v3-case-feed-items">
          {shown.map((item, index) => <FeedItem key={key(item, index)} item={item} today={input.work.today} historyHref={input.hrefs.history} />)}
        </ol>
        {rest.length > 0 ? (
          // Остальное — тем же списком ниже по «Показать ещё»; фокус — на первую открытую строку.
          <FeedMore count={rest.length} start={shown.length + 1} testId="v3-case-feed-more">
            {rest.map((item, index) => <FeedItem key={key(item, shown.length + index)} item={item} today={input.work.today}
              historyHref={input.hrefs.history} focusTarget={index === 0} />)}
          </FeedMore>
        ) : null}
      </>) : (
        <p className="mt-3 border-t border-border pt-3 t-body-compact text-fg-2">Заметок и событий пока нет.</p>
      )}
      {input.notesOlderHref || input.notesLatestHref ? (
        <nav aria-label="Страницы заметок" className="flex flex-wrap gap-x-5">
          {input.notesLatestHref ? <Link href={input.notesLatestHref} prefetch={false} className={LINK}>К последним</Link> : null}
          {input.notesOlderHref ? <Link href={input.notesOlderHref} prefetch={false} className={LINK}>Ранее</Link> : null}
        </nav>
      ) : null}
    </section>
  );
}

/**
 * «Обзор» Student 360 (Э4, 27.09.2026; по образцу Lead 360 #1078). От 1280 px
 * две колонки: слева работа — «Задачи» (строки «Задач» с выполнением на месте),
 * «Обращения студента» — и под ней «Лента» вниз по странице, за ней свёрнутые
 * группы правки; справа за волосяной линией «Сведения». Ширина правой колонки
 * — как у Lead 360; левая колонка не ждёт высоты правой: лента идёт сразу за
 * работой. На телефоне: работа, «Сведения», «Лента», группы.
 */
export function CaseOverview(input: CaseOverviewInput) {
  return (
    <div className="grid gap-x-8 gap-y-8 xl:grid-cols-[minmax(0,1fr)_22rem] xl:grid-rows-[auto_1fr]" data-testid="v3-case-overview">
      <div className="min-w-0 space-y-6 xl:col-start-1 xl:row-start-1">
        <Tasks input={input} />
        {input.help}
      </div>
      <div className="min-w-0 xl:col-start-2 xl:row-span-2 xl:row-start-1 xl:border-s xl:border-border xl:ps-6">
        <Facts input={input} />
      </div>
      <div className="flex min-w-0 flex-col gap-8 xl:col-start-1 xl:row-start-2">
        <Feed input={input} />
        <Groups input={input} />
      </div>
    </div>
  );
}
