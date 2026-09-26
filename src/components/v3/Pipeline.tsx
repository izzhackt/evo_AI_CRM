"use client";

import type { ActivePlatformActor } from "@/lib/platform-auth";
import { isStaffPreview, staffHasPermission } from "@/lib/platform-access";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";

import { Icon } from "@/components/icons";
import { cn } from "@/components/ui";
import {
  BOARD_CARD_CLASS,
  BOARD_EMPTY,
  BOARD_PANEL_FOLD,
  BoardColumn,
  BoardRail,
  boardTracks,
  ownerInitials,
} from "@/components/v3/board/Board";
import { PipelineDecisionForm } from "@/components/v3/PipelineDecisionForm";
import { ClosedLine, CloseRecordMenu } from "@/components/v3/closure/Closure";
import type { LeadClosureReceipt } from "@/lib/platform-closure-contract";
import { closureWords } from "@/lib/v3/wording";
import type {
  PlatformSalesOwnerOption,
  PlatformSalesStage,
  PlatformSalesWorkflowLead,
} from "@/lib/platform-sales-contract";
import type { PlatformSalesLeadLatestNote } from "@/lib/platform-sales";
import { pipelineReturnHref, withPipelineReturn } from "@/lib/v3/pipeline-return";

export type PipelineStageKey = PlatformSalesStage | "handed_off";

export type PipelineStage = Readonly<{
  key: PipelineStageKey;
  title: string;
  gate: boolean;
  terminal: boolean;
}>;

export type PipelineLead = Readonly<{
  id: string;
  name: string;
  stageKey: PipelineStageKey;
  source: string;
  nextAction: string | null;
  nextActionAt: string | null;
  due: "overdue" | "today" | "later" | "none";
  stageAgeDays: number | null;
  latestNote: PlatformSalesLeadLatestNote | null;
  href: string;
  workflow: PlatformSalesWorkflowLead;
}>;

/**
 * Терминальная колонка копится вечно, поэтому свёрнутой она показывает только
 * последние карточки: строки приходят от RPC новыми вперёд, срез честен.
 */
const HANDED_VISIBLE_LIMIT = 20;

/**
 * Срок назван словом, а не только цветом точки (DESIGN.md: «Просрочка названа
 * словом»). Позже сегодняшнего — ничего: дата стоит в третьей строке.
 */
export const DUE_WORD: Record<PipelineLead["due"], Readonly<{ word: string; tone: string }> | null> = {
  overdue: { word: "прошёл", tone: "text-danger" },
  today: { word: "сегодня", tone: "text-warn" },
  later: null,
  none: null,
};

const NOTE_TIME = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Bishkek",
});

export function stageAgeCopy(days: number): string {
  return `${days} дн. на стадии`;
}

/**
 * Возраст на стадии в карточке: «4 дн.»; «на стадии» — в подсказке и для
 * читалки, чтобы узкая колонка 1280 px не обрезала строку посреди слова.
 */
function StageAge({ days }: Readonly<{ days: number }>) {
  return (
    <span title={stageAgeCopy(days)}>
      {days} дн.<span className="sr-only"> на стадии</span>
    </span>
  );
}

function DueWord({ due }: Readonly<{ due: PipelineLead["due"] }>) {
  const mark = DUE_WORD[due];
  if (!mark) return null;
  return (
    <span className={`t-caption shrink-0 ${mark.tone}`}>
      <span className="sr-only">срок </span>
      {mark.word}
    </span>
  );
}

/** Адрес доски с изменёнными параметрами; прочие фильтры сохраняются. */
function useBoardHref() {
  const pathname = usePathname() ?? "/v3/pipeline";
  const search = useSearchParams();
  return (patch: Readonly<Record<string, string | null>>) => {
    const params = new URLSearchParams(search?.toString() ?? "");
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) params.delete(key);
      else params.set(key, value);
    }
    const query = params.toString();
    return query ? `${pathname}?${query}` : pathname;
  };
}

/** Панель открывается без запроса к серверу, но остаётся в адресе (`?lead=`). */
function pushBoardState(event: MouseEvent<HTMLAnchorElement>, href: string): boolean {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  event.preventDefault();
  window.history.pushState(null, "", href);
  return true;
}

function LeadCard({
  lead,
  terminal,
  selected,
  showOwner,
  href,
  onOpen,
}: {
  lead: PipelineLead;
  terminal: boolean;
  selected: boolean;
  showOwner: boolean;
  href: string;
  onOpen: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const owner = lead.workflow.currentOwnerDisplayName;
  const dueDate = lead.nextActionAt ? lead.workflow.nextActionDueDate : null;
  const due = terminal ? "later" : lead.due;
  // Третья строка: слово срока рядом со своей датой («прошёл 23.09»),
  // «сегодня» без даты, позже — только дата; затем «4 дн.». Имя в первой
  // строке и срок в третьей получают всю ширину карточки, а инициалы
  // ответственного стоят справа от его следующего действия.
  const meta: ReactNode[] = [];
  if (dueDate) {
    meta.push(
      due === "today" ? (
        <time key="due" dateTime={dueDate}>
          <DueWord due="today" />
        </time>
      ) : (
        <span key="due">
          {due === "overdue" ? (
            <>
              <DueWord due="overdue" />{" "}
            </>
          ) : null}
          <time dateTime={dueDate} className="font-mono tabular-nums">
            {lead.nextActionAt}
          </time>
        </span>
      ),
    );
  }
  if (!terminal && lead.stageAgeDays !== null) meta.push(<StageAge key="age" days={lead.stageAgeDays} />);
  const actionLine = !(terminal && !lead.nextAction);
  const initials = showOwner && owner ? (
    <abbr title={owner} className="shrink-0 no-underline">
      {ownerInitials(owner)}
    </abbr>
  ) : null;

  return (
    <article
      data-testid="v3-pipeline-card"
      data-lead-id={lead.id}
      aria-current={selected ? "true" : undefined}
      className={`v3-choice ${BOARD_CARD_CLASS}`}
    >
      <p className="flex min-w-0 items-baseline gap-2">
        {/* Вся карточка нажимается: ссылка растянута на неё псевдоэлементом. */}
        <Link
          href={href}
          prefetch={false}
          scroll={false}
          onClick={onOpen}
          title={lead.name}
          data-lead-link={lead.id}
          className="t-item min-w-0 flex-1 truncate text-fg after:absolute after:inset-0 after:rounded-ctl"
        >
          {lead.name}
        </Link>
        {/* Переданный лид без действия: инициалы у имени, а не одни в строке. */}
        {actionLine ? null : initials ? <span className="t-meta text-fg-3">{initials}</span> : null}
      </p>
      {actionLine ? (
        <p className="t-meta flex min-w-0 items-baseline gap-2 text-fg-3">
          <span className={`min-w-0 flex-1 truncate ${lead.nextAction ? "text-fg-2" : ""}`} title={lead.nextAction ?? undefined}>
            {lead.nextAction ?? "Без следующего действия"}
          </span>
          {initials}
        </p>
      ) : null}
      {meta.length > 0 ? (
        <p className="t-meta truncate whitespace-nowrap text-fg-3">
          {meta.flatMap((part, index) => (index === 0 ? [part] : [<span key={`dot-${index}`} aria-hidden="true"> · </span>, part]))}
        </p>
      ) : null}
    </article>
  );
}

function LeadPanel({
  lead,
  stageTitle,
  terminal,
  workflowStages,
  ownerOptions,
  ownerOptionsHaveMore,
  actor,
  actorMembershipId,
  requestId,
  closeHref,
  returnTo,
  saved,
  onClose,
  onSaved,
  onLeadClosed,
}: {
  lead: PipelineLead;
  stageTitle: string;
  terminal: boolean;
  workflowStages: readonly Readonly<{ key: PlatformSalesStage; title: string }>[];
  ownerOptions: readonly PlatformSalesOwnerOption[];
  ownerOptionsHaveMore: boolean;
  actor: ActivePlatformActor;
  actorMembershipId: string;
  requestId: string;
  closeHref: string;
  /** Текущее состояние доски — туда ведёт «К воронке продаж» из карточки. */
  returnTo: string;
  saved: boolean;
  onClose: () => void;
  onSaved: () => void;
  /** «Закрыть лид» подтверждён сервером: лид уходит с доски. */
  onLeadClosed: (receipt: LeadClosureReceipt) => void;
}) {
  const headingId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const savedRef = useRef<HTMLParagraphElement>(null);
  // Закрытия, которые сделала сама панель при смене вида: событие `close`
  // приходит позже задачей, и его нельзя принять за закрытие человеком.
  const switchingCloses = useRef(0);
  const owner = lead.workflow.currentOwnerDisplayName;

  // Широкий экран (контейнер от 72rem): панель — немодальный диалог в ряду с
  // доской, доска остаётся рабочей. Уже — лист поверх страницы, поэтому
  // модальный: страница за ним инертна, Escape закрывает его, где бы ни был
  // фокус. Какой вид сейчас, говорит CSS самой панели (запрос контейнера),
  // а не второе правило в JS.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const sync = () => {
      const sheet = getComputedStyle(dialog).position === "fixed";
      if (dialog.open && dialog.matches(":modal") === sheet) return;
      if (dialog.open) {
        switchingCloses.current += 1;
        dialog.close();
      }
      if (sheet) dialog.showModal();
      else dialog.show();
    };
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);

  // Итог сохранения появляется после обновления доски под кнопкой — панель
  // докручивается до него, если он оказался ниже края.
  useEffect(() => {
    if (saved) savedRef.current?.scrollIntoView({ block: "nearest" });
  }, [saved]);

  return (
    <dialog
      ref={dialogRef}
      open
      aria-labelledby={headingId}
      data-testid="v3-pipeline-lead-panel"
      data-lead-id={lead.id}
      onClose={() => {
        if (switchingCloses.current > 0) {
          switchingCloses.current -= 1;
          return;
        }
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onClose();
      }}
      className="fixed inset-y-0 end-0 start-auto z-40 m-0 hidden h-dvh max-h-none w-full max-w-[420px] flex-col border-s border-border bg-surface p-0 text-fg shadow-evo-lg backdrop:bg-black/45 open:flex @6xl:static @6xl:z-auto @6xl:h-full @6xl:w-[400px] @6xl:max-w-none @6xl:shrink-0 @6xl:rounded-card @6xl:border @6xl:shadow-none"
    >
      <header className="flex shrink-0 items-start gap-2 border-b border-border py-2 pe-2 ps-4">
        <h2 id={headingId} tabIndex={-1} className="t-record-title min-w-0 flex-1 break-words py-2 text-fg">
          {lead.name}
        </h2>
        {/* «⋯» лида: «Закрыть лид». Переданный лид — продажа: пункт недоступен
            и называет причину. Права — подсказка; решает сервер (246). */}
        {!isStaffPreview(actor) && staffHasPermission(actor, "lead.sales.workflow.manage") ? (
          <CloseRecordMenu
            kind="lead"
            subjectId={lead.workflow.leadId}
            subjectName={lead.name}
            expectedVersion={lead.workflow.workflowVersion}
            blockedReason={terminal ? closureWords.lead.handedOff : null}
            onClosed={onLeadClosed}
          />
        ) : null}
        <Link
          href={closeHref}
          prefetch={false}
          scroll={false}
          aria-label="Закрыть"
          onClick={(event) => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            onClose();
          }}
          className="flex size-11 shrink-0 items-center justify-center rounded-nav text-fg-2 hover:bg-surface-2 hover:text-fg"
        >
          <Icon name="x" size={20} />
        </Link>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-3">
        <dl className="t-body-compact grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-fg">
          <dt className="t-caption pt-0.5 text-fg-3">Этап</dt>
          <dd>{stageTitle}</dd>
          <dt className="t-caption pt-0.5 text-fg-3">Ответственный</dt>
          <dd className={owner ? undefined : "text-fg-3"}>{owner ?? "Не назначен"}</dd>
          <dt className="t-caption pt-0.5 text-fg-3">Действие</dt>
          <dd className={`break-words ${lead.nextAction ? "" : "text-fg-3"}`}>{lead.nextAction ?? "Без следующего действия"}</dd>
          {lead.nextActionAt && lead.workflow.nextActionDueDate ? (
            <>
              <dt className="t-caption pt-0.5 text-fg-3">Срок</dt>
              <dd className="flex items-baseline gap-2">
                <time dateTime={lead.workflow.nextActionDueDate} className="font-mono tabular-nums">{lead.nextActionAt}</time>
                {terminal ? null : <DueWord due={lead.due} />}
              </dd>
            </>
          ) : null}
          {!terminal && lead.stageAgeDays !== null ? (
            <>
              <dt className="t-caption pt-0.5 text-fg-3">На стадии</dt>
              <dd className="tabular-nums">{lead.stageAgeDays} дн.</dd>
            </>
          ) : null}
        </dl>

        <p className="mt-2 flex flex-wrap gap-x-5">
          <Link href={withPipelineReturn(lead.href, returnTo)} prefetch={false} className="t-item inline-flex min-h-11 items-center text-accent-text underline underline-offset-4">
            Открыть карточку лида
          </Link>
          {/* Ролям без права на задачи ссылка просто не показывается —
              без постоянной строки-инструкции в каждой карточке. */}
          {!isStaffPreview(actor) && staffHasPermission(actor, "staff.task.read") ? (
            <Link href={`/v3/tasks?lead=${lead.workflow.leadId}&create=staff`} prefetch={false} className="t-item inline-flex min-h-11 items-center text-fg-2 underline underline-offset-4 hover:text-fg">
              Задачи по лиду
            </Link>
          ) : null}
        </p>

        {lead.latestNote ? (
          <section aria-label="Последняя заметка" className="mt-3 border-t border-border pt-3">
            <h3 className="t-caption text-fg-3">Последняя заметка</h3>
            <p className="t-body-compact mt-1 line-clamp-6 whitespace-pre-wrap break-words text-fg-2">{lead.latestNote.body}</p>
            <p className="t-meta mt-1 truncate text-fg-3">
              {lead.latestNote.authorDisplayName}
              {" · "}
              <time dateTime={lead.latestNote.createdAt} className="font-mono tabular-nums">
                {NOTE_TIME.format(new Date(lead.latestNote.createdAt))}
              </time>
            </p>
          </section>
        ) : null}

        {!terminal && !isStaffPreview(actor) && staffHasPermission(actor, "lead.sales.workflow.manage") ? (
          <div className="mt-3 border-t border-border pt-3">
            <PipelineDecisionForm
              key={`${lead.workflow.leadId}:${lead.workflow.workflowVersion}`}
              lead={lead.workflow}
              stages={workflowStages}
              ownerOptions={ownerOptions}
              ownerOptionsHaveMore={ownerOptionsHaveMore}
              actor={actor}
              actorMembershipId={actorMembershipId}
              requestId={requestId}
              onSaved={onSaved}
            />
            {/* Итог — там же, где его показывала форма до обновления доски:
                у кнопки, куда смотрит сотрудник. */}
            {saved ? <p ref={savedRef} role="status" className="t-body-compact mt-2 text-ok">Решение сохранено.</p> : null}
          </div>
        ) : null}
      </div>
    </dialog>
  );
}

export function Pipeline({
  stages,
  leads,
  ownerOptions,
  ownerOptionsHaveMore,
  actor,
  actorMembershipId,
  requestIds,
  handedExpanded,
  filteredStage,
  showOwner,
}: {
  stages: readonly PipelineStage[];
  leads: readonly PipelineLead[];
  ownerOptions: readonly PlatformSalesOwnerOption[];
  ownerOptionsHaveMore: boolean;
  actor: ActivePlatformActor;
  actorMembershipId: string;
  requestIds: Readonly<Record<string, string>>;
  handedExpanded: boolean;
  /** Этап в фокусе (`?stage=`); остальные колонки — рейки с числами. */
  filteredStage: PipelineStageKey | "all";
  /** Инициалы ответственного не нужны, когда показаны только «Мои». */
  showOwner: boolean;
}) {
  const search = useSearchParams();
  const router = useRouter();
  const boardHref = useBoardHref();
  const rootRef = useRef<HTMLDivElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  // Закрытый лид уходит с доски; строка над доской называет его и даёт
  // настоящий «Вернуть в работу» (обратная команда 246).
  // `reopened` — «Вернуть в работу» подтверждён: строка говорит итог, пока её не скроют.
  const [closedNotice, setClosedNotice] = useState<Readonly<{ name: string; receipt: LeadClosureReceipt; reopened: boolean }> | null>(null);
  const focusPanel = useRef(false);
  const returnFocusTo = useRef<Readonly<{ leadId: string; stage: PipelineStageKey | null }> | null>(null);
  // Сохранённое решение: лид и версия, с которой его сохранили. Пока доска
  // не обновилась, итог показывает сама форма; после обновления форма
  // пересоздаётся с новой версией, и итог остаётся строкой панели — без
  // двух одинаковых «Решение сохранено.» подряд.
  const [saved, setSaved] = useState<Readonly<{ leadId: string; version: string }> | null>(null);
  const idPrefix = useId();

  const selectedId = search?.get("lead") ?? null;
  const selected = leads.find((lead) => lead.id === selectedId) ?? null;
  const selectedStage = selected ? stages.find((stage) => stage.key === selected.stageKey) : undefined;
  const focus = filteredStage;
  const workflowStages = stages.flatMap((stage) =>
    stage.key === "handed_off"
      ? []
      : [{ key: stage.key, title: stage.title }],
  );
  const terminalKeys = stages.filter((stage) => stage.terminal).map((stage) => stage.key);
  const stageKeys = stages.map((stage) => stage.key);
  const tracks = boardTracks(stageKeys, focus, terminalKeys);
  // Панель открыта при всех этапах: где шести колонкам рядом с ней не хватает
  // места, раскрыт только этап выбранного лида (дорожки как у фокуса). Для
  // переданного лида это «Переданы»: рабочие этапы сворачиваются в рейки,
  // а не сжимаются до 111 px рядом с панелью.
  const foldFor = focus === "all" && selectedStage ? selectedStage.key : null;
  const boardStyle = {
    "--board-tracks": tracks,
    ...(foldFor ? { "--board-tracks-panel": boardTracks(stageKeys, foldFor, terminalKeys) } : {}),
  } as CSSProperties;
  const emptyWorking = focus === "all"
    ? stages.filter((stage) => !stage.terminal && !leads.some((lead) => lead.stageKey === stage.key))
    : [];

  // Открытие с карточки переводит фокус в панель, закрытие — обратно на
  // карточку. Открытие по адресу (обновление страницы) фокус не забирает.
  useEffect(() => {
    if (selected && focusPanel.current) {
      focusPanel.current = false;
      rootRef.current?.querySelector<HTMLElement>('[data-testid="v3-pipeline-lead-panel"] h2')?.focus();
    }
    if (!selected && returnFocusTo.current) {
      const { leadId, stage } = returnFocusTo.current;
      returnFocusTo.current = null;
      // Карточка переданного лида уходит вместе с раскрытой рядом с панелью
      // колонкой «Переданы» — тогда фокус встаёт на рейку её этапа.
      const root = rootRef.current;
      const shown = (element: HTMLElement) => element.getClientRects().length > 0;
      const card = [...(root?.querySelectorAll<HTMLElement>(`[data-lead-link="${leadId}"]`) ?? [])].find(shown);
      const rail = stage ? [...(root?.querySelectorAll<HTMLElement>(`[data-stage-rail="${stage}"]`) ?? [])].find(shown) : undefined;
      (card ?? rail)?.focus();
    }
  }, [selected]);

  const openLead = (lead: PipelineLead) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (!pushBoardState(event, boardHref({ lead: lead.id }))) return;
    focusPanel.current = true;
    if (saved?.leadId !== lead.id) setSaved(null);
  };
  const closePanel = () => {
    returnFocusTo.current = selectedId ? { leadId: selectedId, stage: selected?.stageKey ?? null } : null;
    setSaved(null);
    if (search?.get("lead")) window.history.pushState(null, "", boardHref({ lead: null }));
  };
  function leadClosed(name: string, receipt: LeadClosureReceipt) {
    setClosedNotice({ name, receipt, reopened: false });
    returnFocusTo.current = null;
    setSaved(null);
    if (search?.get("lead")) window.history.pushState(null, "", boardHref({ lead: null }));
    router.refresh();
  }
  // Карточка закрытого лида уходит с доски (или возвращается) — фокус встаёт на его строку.
  useEffect(() => {
    if (closedNotice) noticeRef.current?.focus();
  }, [closedNotice]);
  // Строку скрыли — она больше не нужна; фокус — на первую карточку доски, а не в никуда.
  function dismissNotice() {
    setClosedNotice(null);
    [...(rootRef.current?.querySelectorAll<HTMLElement>("a[data-lead-link]") ?? [])]
      .find((element) => element.getClientRects().length > 0)?.focus();
  }

  const cardsOf = (stage: PipelineStage) => {
    const inStage = leads.filter((lead) => lead.stageKey === stage.key);
    const visible = stage.terminal && !handedExpanded ? inStage.slice(0, HANDED_VISIBLE_LIMIT) : inStage;
    return { inStage, visible };
  };

  const renderCards = (stage: PipelineStage, visible: readonly PipelineLead[]) =>
    visible.map((lead) => {
      if (!requestIds[lead.id]) {
        throw new Error("Pipeline decision request ID is missing.");
      }
      return (
        <li key={lead.id}>
          <LeadCard
            lead={lead}
            terminal={stage.terminal}
            selected={lead.id === selectedId}
            showOwner={showOwner}
            href={boardHref({ lead: lead.id })}
            onOpen={openLead(lead)}
          />
        </li>
      );
    });

  /** Заголовок колонки без фокуса: ссылка «Только этап …». */
  const stageTitleLink = (stage: PipelineStage, href: string) => (
    <Link
      href={href}
      prefetch={false}
      scroll={false}
      title={`Только этап «${stage.title}»`}
      className="flex min-h-11 min-w-0 items-center truncate rounded-nav hover:underline hover:underline-offset-4"
    >
      <span className="truncate">{stage.title}</span>
    </Link>
  );

  const handedLinks = (stage: PipelineStage, inStage: readonly PipelineLead[], visible: readonly PipelineLead[]) => (
    <>
      {stage.terminal && visible.length < inStage.length ? (
        <li className="col-span-full">
          <Link
            href={boardHref({ handed: "all" })}
            prefetch={false}
            scroll={false}
            className="flex min-h-6 items-center px-1.5 t-item text-fg-2 underline underline-offset-4 hover:text-fg"
          >
            Показать все {inStage.length}
          </Link>
        </li>
      ) : null}
      {stage.terminal && handedExpanded && inStage.length > HANDED_VISIBLE_LIMIT ? (
        <li className="col-span-full">
          <Link
            href={boardHref({ handed: null })}
            prefetch={false}
            scroll={false}
            className="flex min-h-6 items-center px-1.5 t-item text-fg-2 underline underline-offset-4 hover:text-fg"
          >
            Показать последние {HANDED_VISIBLE_LIMIT}
          </Link>
        </li>
      ) : null}
    </>
  );

  return (
    <>
    {closedNotice ? (
      // Фокус переходит сюда после закрытия и возврата: читалка прочтёт строку целиком.
      // Строка живёт до «Скрыть» (или следующего закрытия), а не до ухода со страницы.
      <div ref={noticeRef} tabIndex={-1} data-testid="v3-pipeline-closed-notice"
        className="mb-2 flex shrink-0 items-start gap-2 rounded-ctl border border-border bg-surface ps-3 outline-none focus-visible:outline-2 focus-visible:outline-focus-ring">
        {closedNotice.reopened ? (
          <p role="status" className="flex min-h-11 min-w-0 flex-1 items-center break-words t-body-compact text-ok">
            Лид «{closedNotice.name}» снова в работе.
          </p>
        ) : (
          <ClosedLine
            key={`${closedNotice.receipt.leadId}:${closedNotice.receipt.changedAt}`}
            kind="lead"
            subject={<>Лид «{closedNotice.name}»</>}
            subjectId={closedNotice.receipt.leadId}
            expectedVersion={closedNotice.receipt.workflowVersion}
            reasonKey={closedNotice.receipt.reason}
            note={closedNotice.receipt.note}
            closedAt={closedNotice.receipt.changedAt}
            canReopen
            onReopened={() => {
              setClosedNotice((notice) => notice ? { ...notice, reopened: true } : notice);
              router.refresh();
            }}
            className="min-w-0 flex-1 pt-3"
          />
        )}
        <button type="button" onClick={dismissNotice} aria-label={closureWords.dismiss}
          data-testid="v3-pipeline-closed-notice-dismiss"
          className="flex size-11 shrink-0 items-center justify-center rounded-nav text-fg-2 hover:bg-surface-2 hover:text-fg">
          <Icon name="x" size={20} />
        </button>
      </div>
    ) : null}
    {/* Широкий экран: доска и панель лида — один ряд, панель не перекрывает
        колонки, а забирает у доски 408 px. */}
    <div ref={rootRef} className="relative flex min-w-0 flex-col @6xl:h-full @6xl:min-h-0 @6xl:flex-row @6xl:gap-2">
      <div
        role="group"
        aria-label="Воронка продаж"
        data-testid="v3-pipeline-board"
        data-focus={focus}
        className={cn(
          "flex min-w-0 flex-col gap-4 @6xl:grid @6xl:h-full @6xl:min-h-0 @6xl:flex-1 @6xl:grid-rows-[minmax(0,1fr)] @6xl:gap-2 @6xl:[grid-template-columns:var(--board-tracks)]",
          foldFor && BOARD_PANEL_FOLD.tracks,
        )}
        style={boardStyle}
      >
        {stages.map((stage) => {
          const { inStage, visible } = cardsOf(stage);
          const headingId = `${idPrefix}-${stage.key}`;
          const focusHref = boardHref({ stage: stage.key });

          if (focus !== "all" && focus !== stage.key) {
            // Свёрнутая колонка: только на широком экране; на узком виден
            // один этап в фокусе.
            return (
              <BoardRail
                key={stage.key}
                title={stage.title}
                count={inStage.length}
                href={focusHref}
                className="hidden @6xl:flex"
                testId="v3-pipeline-rail"
              />
            );
          }

          if (stage.terminal && focus === "all") {
            // «Переданы» — исход, а не рабочий этап: рейка справа на широком
            // экране, свёрнутая группа в конце списка на узком. Открыта панель
            // переданного лида и места мало — рейку заменяет колонка с его
            // карточкой, а рабочие этапы свёрнуты (одна дорожка, один элемент).
            const unfold = foldFor === stage.key;
            return (
              <div key={stage.key} className="contents">
                {emptyWorking.length > 0 ? (
                  <p className="t-meta text-fg-3 @6xl:hidden">
                    Пусто: {emptyWorking.map((one) => one.title).join(", ")}
                  </p>
                ) : null}
                <BoardRail
                  title={stage.title}
                  count={inStage.length}
                  href={focusHref}
                  stage={stage.key}
                  className={unfold ? BOARD_PANEL_FOLD.wideRail : "hidden @6xl:flex"}
                  testId="v3-pipeline-rail"
                />
                {unfold ? (
                  <BoardColumn
                    headingId={headingId}
                    testId="v3-pipeline-column"
                    spread
                    title={stageTitleLink(stage, focusHref)}
                    count={inStage.length}
                    emptyText={BOARD_EMPTY.leads}
                    className={BOARD_PANEL_FOLD.column}
                  >
                    {renderCards(stage, visible)}
                    {handedLinks(stage, inStage, visible)}
                  </BoardColumn>
                ) : null}
                {inStage.length > 0 ? (
                  <details className="border-t border-border @6xl:hidden">
                    <summary className="t-item flex min-h-11 cursor-pointer items-center gap-2 px-1.5 text-fg">
                      {stage.title}
                      <span className="t-meta tabular-nums text-fg-3">{inStage.length}</span>
                    </summary>
                    <ul className="flex flex-col gap-1.5 pb-2">
                      {renderCards(stage, visible)}
                      {handedLinks(stage, inStage, visible)}
                    </ul>
                  </details>
                ) : null}
              </div>
            );
          }

          const focused = focus === stage.key;
          return (
            <BoardColumn
              key={stage.key}
              headingId={headingId}
              testId="v3-pipeline-column"
              spread={focused || foldFor === stage.key}
              fold={foldFor && foldFor !== stage.key ? { title: stage.title, href: boardHref({ stage: stage.key, lead: null }) } : undefined}
              title={focused ? <span className="truncate">{stage.title}</span> : stageTitleLink(stage, focusHref)}
              marker={
                stage.gate ? (
                  <span title="Есть условия" className="flex shrink-0 items-center text-fg-3">
                    <Icon name="lock" size={14} />
                    <span className="sr-only">Есть условия</span>
                  </span>
                ) : null
              }
              count={inStage.length}
              headerAction={
                focused ? (
                  <Link
                    href={boardHref({ stage: null })}
                    prefetch={false}
                    scroll={false}
                    className="t-meta inline-flex min-h-11 shrink-0 items-center px-1 text-fg-2 underline underline-offset-4 hover:text-fg"
                  >
                    Все этапы
                  </Link>
                ) : null
              }
              emptyText={BOARD_EMPTY.leads}
              className={inStage.length === 0 && !focused ? "hidden @6xl:flex" : "flex"}
            >
              {renderCards(stage, visible)}
              {handedLinks(stage, inStage, visible)}
            </BoardColumn>
          );
        })}
      </div>

      {selected ? (
        <LeadPanel
          lead={selected}
          stageTitle={selectedStage?.title ?? ""}
          terminal={selectedStage?.terminal ?? false}
          workflowStages={workflowStages}
          ownerOptions={ownerOptions}
          ownerOptionsHaveMore={ownerOptionsHaveMore}
          actor={actor}
          actorMembershipId={actorMembershipId}
          requestId={requestIds[selected.id] ?? ""}
          closeHref={boardHref({ lead: null })}
          returnTo={pipelineReturnHref(search)}
          saved={saved?.leadId === selected.id && saved.version !== selected.workflow.workflowVersion}
          onClose={closePanel}
          onSaved={() => setSaved({ leadId: selected.id, version: selected.workflow.workflowVersion })}
          onLeadClosed={(receipt) => leadClosed(selected.name, receipt)}
        />
      ) : null}
    </div>
    </>
  );
}
