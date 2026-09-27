import Link from "next/link";

import { Icon } from "@/components/icons";
import {
  requestOpenKey,
  requestKindOfSource,
  requestsHref,
  type RequestRow,
  type RequestSelection,
  type RequestsQueue,
} from "@/lib/requests-queue-contract";
import { formatStudentApplicationAnswers } from "@/lib/student-application-presentation";
import {
  REQUEST_SOURCE_WORDS,
  REQUEST_STATUS_LABELS,
  requestClosedKinds,
  requestLatestLine,
  requestReceived,
  requestTabs,
  requestTriage,
  type RequestTriage,
} from "@/lib/v3/requests-view";

import { ApplicationDecision } from "../admissions/StudentApplications";
import { BoardSegments } from "../board/Board";
import { Initials } from "../blocks/Initials";
import { isNextLook, type V3Look } from "../blocks/look";
import { StatusChip } from "../blocks/StatusChip";
import { ManualLeadTrigger } from "../ManualLeadForm";
import { QueueDetailPanel } from "../queue/QueueDetailPanel";
import { QueueKeyboard } from "../queue/QueueKeyboard";
import { QUEUE_QUIET_LINK, QueueError } from "../queue/QueueStates";
import { QueueViewTabs } from "../queue/QueueViewTabs";
import { PortalConsultationDetails } from "./PortalConsultations";
import { TakeFeedback, TakeLeadButton, TakeStatus } from "./TakeLead";

export type RequestsQueueRead =
  | Readonly<{ status: "ready"; queue: RequestsQueue }>
  | Readonly<{ status: "forbidden" | "invalid" | "unavailable" }>;

type ViewProps = Readonly<{
  selection: RequestSelection;
  read: RequestsQueueRead;
  /** Запись правой панели из адреса (`?open=kind:id`). */
  open: Readonly<{ kind: RequestRow["kind"]; id: string }> | null;
  actorMembershipId: string;
  /** Просмотр роли: действий нет. */
  readOnly: boolean;
  /** «Добавить лида» разрешено (форма стоит в шапке страницы). */
  canCreateLead: boolean;
  /** Момент чтения сервера: одинаковые «пришла» при рендере и гидрации. */
  nowIso: string;
  /** request_id «Взять себе» по лиду: один на строку и её панель. */
  takeRequestIds: Readonly<Record<string, string>>;
  /** request_id решения по анкете в панели. */
  decisionRequestId: string;
  look?: V3Look;
}>;

const EMPTY_WHAT: Readonly<Record<RequestSelection["source"], string>> = {
  all: "Сюда приходят заявки с сайта и из WhatsApp, анкеты поступающих и запросы консультаций из кабинета студента.",
  website: "Сюда приходят заявки с формы сайта.",
  whatsapp: "Сюда приходят обращения из WhatsApp, когда он подключён.",
  platform_application: "Сюда приходят анкеты поступающих с сайта.",
  portal_consultation: "Сюда приходят запросы консультаций из кабинета студента.",
};

function leadCardHref(leadId: string, listHref: string): string {
  return `/v3/profile?id=${encodeURIComponent(leadId)}&returnTo=${encodeURIComponent(listHref)}`;
}

function rowLeadId(row: RequestRow): string | null {
  return row.kind === "consultation" ? null : row.leadId;
}

/** Разбор строкой: ответственный, «Взять себе» или состояние словом. */
function TriageCell({ row, triage, props, listHref }: Readonly<{
  row: RequestRow; triage: RequestTriage; props: ViewProps; listHref: string;
}>) {
  const next = isNextLook(props.look);
  switch (triage.kind) {
    case "take":
      return row.kind === "lead" && row.take ? (
        <TakeLeadButton leadId={row.leadId} take={row.take} actorMembershipId={props.actorMembershipId}
          requestId={props.takeRequestIds[row.leadId]} personName={row.personName} leadHref={leadCardHref(row.leadId, listHref)} />
      ) : null;
    case "owner":
      return (
        <span className="flex min-w-0 items-center gap-2 t-body-compact text-fg">
          {/* Без своей колонки ответственный помечен «отв.» — как «исп.» у «Задач». */}
          <span className="t-meta text-fg-3 @min-[56rem]:hidden">отв.</span>
          {next && !triage.mine ? <Initials name={triage.name} decorative /> : null}
          <span className="min-w-0 truncate" title={triage.name}>{triage.name}</span>
        </span>
      );
    case "untaken":
      return <span className="t-body-compact text-fg-2">Без ответственного</span>;
    case "handed":
      return <span className="t-body-compact text-fg-2">Передан в поступление</span>;
    case "state":
      return (
        <span className="flex min-w-0 items-center gap-2">
          {next
            ? <StatusChip label={triage.word} tone="neutral" />
            : <span className={`shrink-0 t-body-compact ${triage.waiting ? "text-fg" : "text-fg-2"}`}>{triage.word}</span>}
          {triage.by ? <span className="min-w-0 truncate t-meta text-fg-2" title={triage.by}>{triage.by}</span> : null}
        </span>
      );
  }
}

/**
 * Строка разбора на волосяной линии. Уже 36rem своей ширины — стопкой (имя,
 * источник и когда, разбор); 36–56rem — две строки с разбором справа; шире —
 * колонки «Заявка · Источник · Пришла · Разбор». Действие строки одно —
 * «Открыть» правую панель; ссылка покрывает строку, рамка фокуса — у всей
 * строки (`.v3-queue-row`). Имя — ссылка на карточку лида только при мыши на
 * широком экране (как у «Задач» и «Сегодня»), на касании карточка — из панели.
 */
function RequestRowView({ row, props, listHref, now }: Readonly<{
  row: RequestRow; props: ViewProps; listHref: string; now: Date;
}>) {
  const key = requestOpenKey(row);
  const selected = props.open !== null && requestOpenKey(props.open) === key;
  const received = requestReceived(row.occurredAt, now);
  const triage = requestTriage(row, { actorMembershipId: props.actorMembershipId, canAct: !props.readOnly });
  const leadId = rowLeadId(row);
  const source = REQUEST_SOURCE_WORDS[row.source];
  return (
    <li
      data-queue-row={key}
      data-request-kind={row.kind}
      className={`v3-queue-row relative grid grid-cols-[minmax(0,1fr)_2.75rem] items-center gap-x-3 border-b border-border py-1.5 ps-3 @min-[36rem]:grid-cols-[minmax(0,1fr)_minmax(0,12rem)_auto] ${WIDE_COLUMNS} ${selected ? "bg-surface-2" : "hover:bg-surface has-[[data-queue-open]:focus-visible]:bg-surface"}`}
    >
      <p className="col-start-1 row-start-1 min-w-0 py-0.5">
        {leadId ? <>
          <Link href={leadCardHref(leadId, listHref)} title={row.personName}
            className="relative z-10 hidden h-6 max-w-full items-center rounded-nav t-item text-fg underline-offset-2 hover:underline focus-visible:outline-offset-[-2px] md:pointer-fine:inline-flex">
            <span className="truncate">{row.personName}</span>
          </Link>
          <span className="block truncate t-item text-fg md:pointer-fine:hidden" title={row.personName}>{row.personName}</span>
        </> : <span className="block truncate t-item text-fg" title={row.personName}>{row.personName}</span>}
      </p>

      {/* Источник и когда — второй строкой, пока нет своих колонок. */}
      <p className="col-start-1 row-start-2 flex min-w-0 flex-wrap items-center gap-x-1.5 pb-0.5 t-meta text-fg-2 @min-[56rem]:hidden">
        <span>{source}</span>
        <span aria-hidden="true">·</span>
        <time dateTime={received.dateTime} className="font-mono tabular-nums text-fg-2">{received.text}</time>
        <span className="text-fg-3">{received.word}</span>
      </p>
      <p className="hidden t-body-compact text-fg-2 @min-[56rem]:col-start-2 @min-[56rem]:row-start-1 @min-[56rem]:block">{source}</p>
      <p className="hidden whitespace-nowrap t-body-compact @min-[56rem]:col-start-3 @min-[56rem]:row-start-1 @min-[56rem]:flex @min-[56rem]:items-baseline @min-[56rem]:gap-2">
        <time dateTime={received.dateTime} className="font-mono tabular-nums text-fg">{received.text}</time>
        <span className="t-meta text-fg-3">{received.word}</span>
      </p>

      <div className="col-span-2 row-start-3 min-w-0 pb-1 @min-[36rem]:col-span-1 @min-[36rem]:col-start-2 @min-[36rem]:row-span-2 @min-[36rem]:row-start-1 @min-[36rem]:pb-0 @min-[56rem]:col-start-4 @min-[56rem]:row-span-1">
        <TriageCell row={row} triage={triage} props={props} listHref={listHref} />
      </div>

      <div className="col-start-2 row-span-2 row-start-1 flex justify-end @min-[36rem]:col-start-3 @min-[56rem]:col-start-5 @min-[56rem]:row-span-1">
        <Link
          href={requestsHref(props.selection, key)}
          scroll={false}
          data-queue-open=""
          aria-current={selected ? "true" : undefined}
          aria-label={`Открыть: ${source} — ${row.personName}`}
          className="grid min-h-11 min-w-11 place-items-center rounded-nav t-label text-fg-2 before:absolute before:inset-0 before:content-[''] hover:text-fg @min-[36rem]:px-3 @min-[36rem]:underline @min-[36rem]:underline-offset-4"
        >
          <span aria-hidden="true" className="hidden @min-[36rem]:inline">Открыть</span>
          <Icon name="chevron-right" size={20} className="@min-[36rem]:hidden" />
        </Link>
      </div>
    </li>
  );
}

/** Колонки широкой строки и её заголовка: «Заявка · Источник · Пришла · Разбор · Открыть». */
const WIDE_COLUMNS = "@min-[56rem]:grid-cols-[minmax(0,1fr)_7rem_11.5rem_minmax(0,13rem)_6rem]";
const FACT_TERM = "t-caption text-fg-3";
const FACT_VALUE = "min-w-0 break-words t-body-compact text-fg";
const SECTION = "space-y-2 border-t border-border pt-4";

/** Правая панель: заявка целиком и её действия — те же команды, что раньше. */
function RequestDetail({ row, props, listHref, now }: Readonly<{
  row: RequestRow; props: ViewProps; listHref: string; now: Date;
}>) {
  const headingId = `request-${row.kind}-${row.id}`;
  const received = requestReceived(row.occurredAt, now);
  const triage = requestTriage(row, { actorMembershipId: props.actorMembershipId, canAct: !props.readOnly });
  const leadId = rowLeadId(row);
  return (
    <QueueDetailPanel closeHref={listHref} backLabel="К заявкам" headingId={headingId}>
      <div className="space-y-5" data-testid="requests-detail-panel">
        <header className="space-y-2">
          <h2 id={headingId} tabIndex={-1} data-queue-heading="" className="t-record-title break-words text-fg xl:pe-10">{row.personName}</h2>
          <p className="t-body-compact text-fg-2">
            {REQUEST_SOURCE_WORDS[row.source]} · пришла{" "}
            <time dateTime={received.dateTime} className="font-mono tabular-nums text-fg">{received.text}</time>, {received.word}
          </p>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-4 gap-y-1">
            {row.kind === "lead" ? <>
              {row.phone ? <><dt className={FACT_TERM}>Телефон</dt><dd className={FACT_VALUE}>{row.phone}</dd></> : null}
              {row.email ? <><dt className={FACT_TERM}>Почта</dt><dd className={FACT_VALUE}>{row.email}</dd></> : null}
              {!row.phone && !row.email ? <><dt className={FACT_TERM}>Контакт</dt><dd className="t-body-compact text-fg-2">не указан</dd></> : null}
              <dt className={FACT_TERM}>Ответственный</dt>
              <dd className={FACT_VALUE}>
                {triage.kind === "owner" ? triage.name : triage.kind === "handed" ? "Передан в поступление" : <span className="text-fg-2">никто не взял</span>}
              </dd>
            </> : null}
            {row.kind === "application" ? <>
              <dt className={FACT_TERM}>Почта</dt>
              <dd className={FACT_VALUE}>{row.email}</dd>
              <dt className={FACT_TERM}>Состояние</dt>
              <dd className={FACT_VALUE}>{triage.kind === "state" ? triage.word : null}</dd>
            </> : null}
            {row.kind === "consultation" ? <>
              <dt className={FACT_TERM}>Состояние</dt>
              <dd className={FACT_VALUE}>{triage.kind === "state" ? [triage.word, triage.by].filter(Boolean).join(" · ") : null}</dd>
            </> : null}
          </dl>
          {row.kind === "lead" && triage.kind === "take" && row.take ? (
            <TakeLeadButton leadId={row.leadId} take={row.take} actorMembershipId={props.actorMembershipId}
              requestId={props.takeRequestIds[row.leadId]} personName={row.personName} leadHref={leadCardHref(row.leadId, listHref)} />
          ) : null}
          {leadId ? <Link href={leadCardHref(leadId, listHref)} className={QUEUE_QUIET_LINK}>Открыть карточку лида</Link> : null}
        </header>

        {row.kind === "application" ? <>
          <section className={SECTION} aria-label="Заполнено поступающим">
            <h3 className="t-item text-fg">Заполнено поступающим</h3>
            <p className="t-meta text-fg-2">Сведения со слов поступающего, их нужно проверить.</p>
            <dl className="grid grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)] items-baseline gap-x-3 gap-y-2">
              {formatStudentApplicationAnswers(row.application.questionnaire).map(({ label, value }) => (
                <div key={label} className="contents">
                  <dt className={FACT_TERM}>{label}</dt>
                  <dd className={FACT_VALUE}>{value}</dd>
                </div>
              ))}
            </dl>
          </section>
          {row.application.status === "pending" ? props.readOnly
            ? <p className="t-body-compact text-fg-2">В режиме просмотра решения недоступны.</p>
            : <ApplicationDecision application={row.application} requestId={props.decisionRequestId} quiet flat />
            : null}
        </> : null}

        {row.kind === "consultation" ? (
          <section className={SECTION} aria-label="Запрос консультации">
            <PortalConsultationDetails row={row.consultation} readOnly={props.readOnly} refreshHref={listHref} />
          </section>
        ) : null}
      </div>
    </QueueDetailPanel>
  );
}

/** Пустая очередь: что пусто, что сюда приходит, когда пришла последняя и «Добавить лида». */
function RequestsEmpty({ queue, props, now }: Readonly<{
  queue: RequestsQueue; props: ViewProps; now: Date;
}>) {
  const { selection } = props;
  if (selection.cursor) {
    return (
      <div role="status" className="flex flex-col items-center gap-3 border-t border-border py-12 text-center" data-testid="queue-empty">
        <p className="t-item text-fg">На этой странице заявок больше нет: список изменился.</p>
        <Link href={requestsHref({ ...selection, cursor: null })} className={QUEUE_QUIET_LINK}>К началу очереди</Link>
      </div>
    );
  }
  const closed = selection.source === "all" ? [] : requestClosedKinds(queue, selection.source);
  if (closed.length) {
    return (
      <div role="status" className="border-t border-border py-12 text-center" data-testid="queue-empty">
        <p className="t-item text-fg">{closed[0]} вашей роли недоступны.</p>
      </div>
    );
  }
  const latest = requestLatestLine(queue.latestAt, now);
  return (
    <div role="status" className="flex flex-col items-center gap-2 border-t border-border py-12 text-center" data-testid="queue-empty">
      <p className="t-item text-fg">{selection.status === "waiting" ? "Новых заявок нет" : "Заявок нет"}</p>
      <p className="max-w-[60ch] t-body-compact text-fg-2">{EMPTY_WHAT[selection.source]}</p>
      <p className="t-body-compact text-fg-2">{latest ?? "Заявок ещё не было."}</p>
      <div className="flex flex-wrap items-center justify-center gap-x-5">
        {props.canCreateLead ? <ManualLeadTrigger quiet /> : null}
        {selection.status === "waiting" && queue.latestAt
          ? <Link href={requestsHref({ ...selection, status: "all", cursor: null })} className={QUEUE_QUIET_LINK}>Показать все</Link> : null}
      </div>
    </div>
  );
}

/**
 * «Заявки» (Э3, 27.09.2026): очередь разбора. Вкладки источников с числами
 * из чтения, «Ждут разбора / Все» — сразу по нажатию, строки на волосяных
 * линиях, одно «Открыть» — правая панель. Группы «Больше 2 ч» нет: SLA
 * менеджеров план не вводит.
 */
export function RequestsQueueView(props: ViewProps) {
  const { selection, read } = props;
  const now = new Date(props.nowIso);
  const listHref = requestsHref(selection);
  const queue = read.status === "ready" ? read.queue : null;
  const tabs = requestTabs(selection, queue);
  const statusItems = (["waiting", "all"] as const).map((status) => ({
    key: status,
    title: REQUEST_STATUS_LABELS[status],
    count: null,
    href: requestsHref({ ...selection, status, cursor: null }),
    active: selection.status === status,
  }));
  const openRow = queue && props.open ? queue.rows.find((row) => requestOpenKey(row) === requestOpenKey(props.open!)) ?? null : null;
  const panel = openRow ? <RequestDetail row={openRow} props={props} listHref={listHref} now={now} /> : null;
  const selectedKind = selection.source === "all" ? null : requestKindOfSource(selection.source);

  return (
    <TakeFeedback key={listHref}>
    <div className={panel ? "xl:grid xl:grid-cols-[minmax(0,1fr)_26rem] xl:items-start xl:gap-6" : undefined}>
      {/*
        THESIS: утренний разбор входящих — кто пришёл, откуда, когда и взял ли
        кто-нибудь; не взятое берут одной кнопкой здесь же.
        OWN-WORLD: рабочий стол EVO — строки на волосяных линиях без карточек,
        Golos Text, время прихода JetBrains Mono «ДД.ММ ЧЧ:ММ»; сплошной
        красный — только «Добавить лида» в шапке; «Взять себе» — спокойная
        приподнятая кнопка; выбранное — `.v3-choice`.
        FIRST VIEWPORT: 1440×900 — h1 и «Добавить лида», вкладки с числами,
        «Ждут разбора / Все», затем строки по 57 px: имя, источник, когда,
        разбор, «Открыть».
      */}
      <div className="min-w-0 space-y-3" data-testid="requests-queue">
        <QueueViewTabs label="Источник заявки" tabs={tabs} />
        <BoardSegments label="Состояние" items={statusItems} />
        {read.status !== "ready" ? (
          read.status === "forbidden"
            ? <p role="status" className="border-y border-border py-8 t-body-compact text-fg-2">У вашей роли нет доступа к заявкам.</p>
            : <QueueError text={read.status === "invalid" ? "Эта страница очереди больше не открывается." : "Заявки не загрузились. Список и числа сейчас неизвестны."}
              retryHref={read.status === "invalid" ? requestsHref({ ...selection, cursor: null }) : listHref} />
        ) : (
          <>
            <TakeStatus />
            {read.queue.rows.length === 0 ? <RequestsEmpty queue={read.queue} props={props} now={now} /> : (
              <div className="@container min-w-0">
                <div aria-hidden="true" className={`hidden gap-x-3 border-b border-border py-2 ps-3 t-caption text-fg-3 @min-[56rem]:grid ${WIDE_COLUMNS}`}>
                  <span>{selectedKind === "application" ? "Анкета" : selectedKind === "consultation" ? "Консультация" : "Заявка"}</span>
                  <span>Источник</span>
                  <span>Пришла</span>
                  <span>Разбор</span>
                  <span />
                </div>
                <ul data-queue-list="" data-testid="requests-rows">
                  {read.queue.rows.map((row) => <RequestRowView key={requestOpenKey(row)} row={row} props={props} listHref={listHref} now={now} />)}
                </ul>
              </div>
            )}
          </>
        )}
        {queue && (queue.previousCursor || queue.nextCursor) ? (
          <nav aria-label="Страницы заявок" className="flex flex-wrap gap-x-5">
            {queue.previousCursor ? <Link className={QUEUE_QUIET_LINK} href={requestsHref({ ...selection, cursor: queue.previousCursor })}>Предыдущая страница</Link> : null}
            {queue.nextCursor ? <Link className={QUEUE_QUIET_LINK} href={requestsHref({ ...selection, cursor: queue.nextCursor })}>Следующая страница</Link> : null}
          </nav>
        ) : null}
      </div>
      {panel}
      <QueueKeyboard openKey={openRow ? requestOpenKey(openRow) : null} />
    </div>
    </TakeFeedback>
  );
}
