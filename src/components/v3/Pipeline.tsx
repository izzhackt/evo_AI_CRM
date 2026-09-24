"use client";

import type { ActivePlatformActor } from "@/lib/platform-auth";
import { isStaffPreview, staffHasPermission } from "@/lib/platform-access";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState, type MouseEvent } from "react";

import { Icon } from "@/components/icons";
import {
  BOARD_CARD_CLASS,
  BOARD_EMPTY,
  BoardColumn,
  BoardRail,
  boardTracks,
} from "@/components/v3/board/Board";
import { PipelineDecisionForm } from "@/components/v3/PipelineDecisionForm";
import type {
  PlatformSalesOwnerOption,
  PlatformSalesStage,
  PlatformSalesWorkflowLead,
} from "@/lib/platform-sales-contract";
import type { PlatformSalesLeadLatestNote } from "@/lib/platform-sales";

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

/** «Айгүл Осмонова» → «АО»; полное имя остаётся в подсказке. */
export function ownerInitials(name: string): string {
  return name
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => (Array.from(part)[0] ?? "").toLocaleUpperCase("ru-RU"))
    .join("");
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
  const meta = [
    lead.nextActionAt && lead.workflow.nextActionDueDate ? (
      <time key="due" dateTime={lead.workflow.nextActionDueDate} className="font-mono tabular-nums">
        {lead.nextActionAt}
      </time>
    ) : null,
    !terminal && lead.stageAgeDays !== null ? <span key="age">{stageAgeCopy(lead.stageAgeDays)}</span> : null,
  ].filter((part) => part !== null);
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
        {terminal ? null : <DueWord due={lead.due} />}
      </p>
      {terminal && !lead.nextAction ? null : (
        <p className={`t-meta truncate ${lead.nextAction ? "text-fg-2" : "text-fg-3"}`} title={lead.nextAction ?? undefined}>
          {lead.nextAction ?? "Без следующего действия"}
        </p>
      )}
      {meta.length > 0 || initials ? (
        // Узкая колонка обрезает дату и возраст многоточием, а инициалы
        // ответственного остаются видны справа.
        <p className="t-meta flex min-w-0 items-baseline gap-2 whitespace-nowrap text-fg-3">
          <span className="min-w-0 flex-1 truncate">
            {meta.flatMap((part, index) => (index === 0 ? [part] : [<span key={`dot-${index}`} aria-hidden="true"> · </span>, part]))}
          </span>
          {initials}
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
  saved,
  onClose,
  onSaved,
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
  saved: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const headingId = useId();
  const owner = lead.workflow.currentOwnerDisplayName;
  return (
    <aside
      aria-labelledby={headingId}
      data-testid="v3-pipeline-lead-panel"
      data-lead-id={lead.id}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onClose();
      }}
      className="fixed inset-y-0 end-0 z-40 flex w-full max-w-[420px] flex-col border-s border-border bg-surface shadow-evo-lg @6xl:absolute @6xl:z-20"
    >
      <header className="flex shrink-0 items-start gap-2 border-b border-border py-2 pe-2 ps-4">
        <h2 id={headingId} tabIndex={-1} className="t-record-title min-w-0 flex-1 break-words py-2 text-fg">
          {lead.name}
        </h2>
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
          <Link href={lead.href} prefetch={false} className="t-item inline-flex min-h-11 items-center text-accent-text underline underline-offset-4">
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

        {saved ? (
          <p role="status" className="t-body-compact mt-3 border-t border-border pt-3 text-ok">Решение сохранено.</p>
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
          </div>
        ) : null}
      </div>
    </aside>
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
  const boardHref = useBoardHref();
  const rootRef = useRef<HTMLDivElement>(null);
  const focusPanel = useRef(false);
  const returnFocusTo = useRef<string | null>(null);
  const [savedLeadId, setSavedLeadId] = useState<string | null>(null);
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
  const tracks = boardTracks(stages.map((stage) => stage.key), focus, terminalKeys);
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
      const id = returnFocusTo.current;
      returnFocusTo.current = null;
      rootRef.current?.querySelector<HTMLElement>(`[data-lead-link="${id}"]`)?.focus();
    }
  }, [selected]);

  const openLead = (lead: PipelineLead) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (!pushBoardState(event, boardHref({ lead: lead.id }))) return;
    focusPanel.current = true;
    if (savedLeadId !== lead.id) setSavedLeadId(null);
  };
  const closePanel = () => {
    returnFocusTo.current = selectedId;
    setSavedLeadId(null);
    if (search?.get("lead")) window.history.pushState(null, "", boardHref({ lead: null }));
  };

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

  const handedLinks = (stage: PipelineStage, inStage: readonly PipelineLead[], visible: readonly PipelineLead[]) => (
    <>
      {stage.terminal && visible.length < inStage.length ? (
        <li>
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
        <li>
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
    <div ref={rootRef} className="relative flex min-w-0 flex-col @6xl:h-full @6xl:min-h-0">
      <div
        role="group"
        aria-label="Воронка продаж"
        data-testid="v3-pipeline-board"
        data-focus={focus}
        className="flex min-w-0 flex-col gap-4 @6xl:grid @6xl:h-full @6xl:min-h-0 @6xl:grid-rows-[minmax(0,1fr)] @6xl:gap-2"
        style={{ gridTemplateColumns: tracks }}
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
            // экране, свёрнутая группа в конце списка на узком.
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
                  className="hidden @6xl:flex"
                  testId="v3-pipeline-rail"
                />
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
              title={
                focused ? (
                  <span className="truncate">{stage.title}</span>
                ) : (
                  <Link
                    href={focusHref}
                    prefetch={false}
                    scroll={false}
                    title={`Только этап «${stage.title}»`}
                    className="flex min-h-11 min-w-0 items-center truncate rounded-nav hover:underline hover:underline-offset-4"
                  >
                    <span className="truncate">{stage.title}</span>
                  </Link>
                )
              }
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
          saved={savedLeadId === selected.id}
          onClose={closePanel}
          onSaved={() => setSavedLeadId(selected.id)}
        />
      ) : null}
    </div>
  );
}
