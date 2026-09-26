"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";

import { btnGhostCls, cn } from "@/components/ui";
import { Icon } from "@/components/icons";
import {
  BOARD_CARD_CLASS,
  BOARD_EMPTY,
  BoardColumn,
  BoardGrip,
  cappedBoardTracks,
  ownerInitials,
} from "@/components/v3/board/Board";
import { TopLayerMenu } from "@/components/v3/board/TopLayerMenu";
import {
  moveCasePipelineAction,
  type MoveCasePipelineActionStatus,
} from "@/lib/platform-admissions-pipeline-actions";
import {
  ADMISSIONS_PIPELINE_TAB_STAGES,
  admissionsPipelineTabOf,
  type AdmissionsPipelineRow,
  type AdmissionsPipelineStage,
  type AdmissionsPipelineTab,
} from "@/lib/platform-admissions-pipeline-contract";
import { admissionsPipelineStage, admissionsPipelineTab, caseChatAwaitState, country as countryLabel } from "@/lib/v3/wording";
import { Initials } from "@/components/v3/blocks/Initials";
import { isNextLook, type V3Look } from "@/components/v3/blocks/look";
import { StatusChip } from "@/components/v3/blocks/StatusChip";

/** Full sentences only — a saved stage move is silent; removal reports below. */
const MESSAGES: Record<Exclude<MoveCasePipelineActionStatus, "saved"> | "no_response", string> = {
  invalid: "Не удалось подготовить перемещение.",
  forbidden: "У вашей роли нет прав на это перемещение.",
  request_conflict: "Команда уже использована. Повторите действие.",
  unavailable: "Перемещение не подтверждено. Обновите страницу и проверьте этап.",
  no_response: "Ответ сервера не получен. Перемещение не подтверждено — обновите страницу.",
};

/** A lost response is not a confirmed move: the card reverts like any refusal. */
const NO_RESPONSE = { status: "no_response" } as const;

type MoveTarget =
  | Readonly<{ remove: true }>
  | Readonly<{ remove?: false; stage: AdmissionsPipelineStage }>;

/**
 * Removal is a hide, not a delete (187: `pipeline_hidden_at`, the case stays in
 * «Студенты»). «Вернуть в воронку» is the same move command with the previous
 * stage, which clears the hide server-side — no new server semantics.
 */
type RemovalNotice = Readonly<{
  row: AdmissionsPipelineRow;
  phase: "removing" | "removed" | "restoring" | "restored";
}>;

/** A saved move into the other tab leaves this board: say where it went. */
type CrossTabHint = Readonly<{ studentCaseId: string; tab: AdmissionsPipelineTab; name: string; stage: AdmissionsPipelineStage }>;

function removalMessage({ row, phase }: RemovalNotice): string {
  const name = row.studentDisplayName;
  switch (phase) {
    case "removing":
      return `Убираем дело «${name}» из воронки…`;
    case "removed":
      return `Дело «${name}» убрано из воронки.`;
    case "restoring":
      return `Возвращаем дело «${name}» в воронку…`;
    case "restored":
      return `Дело «${name}» снова в воронке.`;
  }
}

function caseHref(studentCaseId: string): string {
  return `/v3/profile?case=${studentCaseId}&tab=route`;
}

function boardHref(basePath: string, params: Readonly<Record<string, string | null>>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== "") search.set(key, value);
  }
  const query = search.toString();
  return query ? `${basePath}?${query}` : basePath;
}

const MENU_ITEM_CLASS = "flex min-h-11 w-full items-center rounded-nav px-2 text-left text-sm text-fg hover:bg-surface-2";

/**
 * «Действия с делом» — меню в top layer (`TopLayerMenu`): колонка с
 * `overflow-y-auto` больше не обрезает его до первой строки. Сначала этапы
 * текущего раздела, этапы другого раздела — за «Другой раздел», затем
 * «Открыть дело» и отдельно «Убрать из воронки» с подтверждением.
 */
function CardMenu({
  row,
  tab,
  onMove,
}: Readonly<{
  row: AdmissionsPipelineRow;
  tab: AdmissionsPipelineTab;
  onMove: (target: MoveTarget) => void;
}>) {
  const removeTriggerRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const returnFocusToTrigger = useRef(false);
  const confirmTextId = useId();
  const otherId = useId();
  // «Убрать из воронки» hides the case from every curator's board, so it never
  // runs from a single click: the item opens an inline confirmation first.
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [otherOpen, setOtherOpen] = useState(false);
  useEffect(() => {
    if (confirmingRemove) {
      cancelRef.current?.focus();
    } else if (returnFocusToTrigger.current) {
      returnFocusToTrigger.current = false;
      removeTriggerRef.current?.focus();
    }
  }, [confirmingRemove]);
  const cancelRemove = () => {
    returnFocusToTrigger.current = true;
    setConfirmingRemove(false);
  };
  const otherTab: AdmissionsPipelineTab = tab === "admission" ? "visa" : "admission";
  const tabTargets = (tabKey: AdmissionsPipelineTab) =>
    ADMISSIONS_PIPELINE_TAB_STAGES[tabKey].filter((stage) => stage !== row.pipelineStage);
  return (
    <TopLayerMenu
      label="Действия с делом"
      trigger={<Icon name="more-horizontal" size={20} />}
      triggerClassName="flex size-11 items-center justify-center rounded-nav text-fg-2 hover:bg-surface-2 hover:text-fg"
      menuClassName="w-64 rounded-ctl border border-border bg-surface p-1 shadow-evo-lg"
      testId="v3-admissions-pipeline-move"
      onOpenChange={(open) => {
        if (open) return;
        setConfirmingRemove(false);
        setOtherOpen(false);
      }}
      onKeyDown={(event) => {
        // Escape сначала отменяет подтверждение удаления, а меню закрывает
        // уже следующий Escape (его обрабатывает сам popover).
        if (event.key !== "Escape" || !confirmingRemove) return;
        event.preventDefault();
        event.stopPropagation();
        cancelRemove();
      }}
    >
      {(close) => (
        <>
          <p className="t-caption px-2 pb-0.5 pt-1 text-fg-3">Переместить в…</p>
          {tabTargets(tab).map((stage) => (
            <button
              key={stage}
              type="button"
              className={MENU_ITEM_CLASS}
              onClick={() => { close(); onMove({ stage }); }}
            >
              {admissionsPipelineStage(stage)}
            </button>
          ))}
          <button
            type="button"
            aria-expanded={otherOpen}
            aria-controls={otherId}
            className={cn(MENU_ITEM_CLASS, "justify-between gap-2")}
            onClick={() => setOtherOpen((previous) => !previous)}
          >
            Другой раздел
            <Icon name="chevron-down" size={16} className={cn("shrink-0 text-fg-3", otherOpen && "rotate-180")} />
          </button>
          <div id={otherId} hidden={!otherOpen} role="group" aria-label={admissionsPipelineTab(otherTab)}>
            <p className="t-caption px-2 pt-1 text-fg-3">{admissionsPipelineTab(otherTab)}</p>
            {tabTargets(otherTab).map((stage) => (
              <button
                key={stage}
                type="button"
                className={cn(MENU_ITEM_CLASS, "ps-4")}
                onClick={() => { close(); onMove({ stage }); }}
              >
                {admissionsPipelineStage(stage)}
              </button>
            ))}
          </div>
          <hr className="my-1 border-border" />
          <Link href={caseHref(row.studentCaseId)} prefetch={false} className={MENU_ITEM_CLASS}>
            Открыть дело
          </Link>
          <hr className="my-1 border-border" />
          {confirmingRemove ? (
            <div role="group" aria-labelledby={confirmTextId} className="rounded-nav bg-danger-weak p-2">
              <p id={confirmTextId} className="t-body-compact break-words px-1 text-fg">
                Убрать «{row.studentDisplayName}» из воронки? Дело останется в «Студентах».
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  className="inline-flex min-h-11 flex-1 items-center justify-center rounded-ctl border border-danger bg-danger px-3 text-sm font-semibold text-on-accent hover:bg-danger/90"
                  onClick={() => { close(); onMove({ remove: true }); }}
                >
                  Убрать
                </button>
                <button
                  ref={cancelRef}
                  type="button"
                  className="inline-flex min-h-11 flex-1 items-center justify-center rounded-ctl border border-control-edge bg-surface px-3 text-sm font-semibold text-fg-2 hover:bg-surface-2 hover:text-fg"
                  onClick={cancelRemove}
                >
                  Отмена
                </button>
              </div>
            </div>
          ) : (
            <button
              ref={removeTriggerRef}
              type="button"
              className="flex min-h-11 w-full items-center rounded-nav px-2 text-left text-sm font-medium text-danger hover:bg-danger-weak"
              onClick={() => setConfirmingRemove(true)}
            >
              Убрать из воронки
            </button>
          )}
        </>
      )}
    </TopLayerMenu>
  );
}

function BoardCard({
  row,
  tab,
  showCurator,
  onMove,
  onDragStart,
  next = false,
}: Readonly<{
  row: AdmissionsPipelineRow;
  tab: AdmissionsPipelineTab;
  showCurator: boolean;
  onMove: (target: MoveTarget) => void;
  onDragStart?: () => void;
  /** Новый облик (Э1.3): куратор — круг инициалов, состояния — чипы со словом. */
  next?: boolean;
}>) {
  const secondLine = [countryLabel(row.targetCountry), row.primaryInstitutionName]
    .filter((value): value is string => Boolean(value))
    .join(" · ");
  // Та же грамматика, что у карточки продаж: куратор — инициалами справа во
  // второй строке (полное имя в подсказке), состояние — словом и цветом в
  // третьей, а не плашками. Новый облик (Э1.3): круг инициалов и чипы со
  // словом; дней просрочки нет — чтение доски даты шага не отдаёт.
  const replyWord = caseChatAwaitState("needs_reply")?.toLocaleLowerCase("ru-RU") ?? "";
  const marks = next ? [
    row.overdue ? <StatusChip key="overdue" label="просрочено" tone="danger" size="sm" /> : null,
    row.needsReply ? (
      // Ссылка на переписку дела: чип 18 px, зона нажатия 44 px (`.v3-chip-link`, v3.css).
      <Link key="reply" href={`/v3/messages?case=${row.studentCaseId}`} prefetch={false} draggable={false} className="v3-chip-link inline-flex">
        <StatusChip label={replyWord} tone="danger" size="sm" />
      </Link>
    ) : null,
    row.awaitingAck ? <StatusChip key="ack" label="ждёт принятия" tone="warn" size="sm" /> : null,
  ].filter((mark) => mark !== null) : [
    row.overdue ? <span key="overdue" className="t-caption text-danger">просрочено</span> : null,
    row.needsReply ? (
      <Link
        key="reply"
        href={`/v3/messages?case=${row.studentCaseId}`}
        prefetch={false}
        draggable={false}
        className="t-caption text-danger underline-offset-4 hover:underline"
      >
        {caseChatAwaitState("needs_reply")?.toLocaleLowerCase("ru-RU")}
      </Link>
    ) : null,
    row.awaitingAck ? <span key="ack" className="t-caption text-warn">ждёт принятия</span> : null,
  ].filter((mark) => mark !== null);
  const curator = showCurator ? row.currentCuratorDisplayName : null;
  return (
    <article
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", row.studentCaseId);
        event.dataTransfer.effectAllowed = "move";
        onDragStart?.();
      }}
      data-testid="v3-admissions-pipeline-card"
      data-student-case-id={row.studentCaseId}
      className={cn(BOARD_CARD_CLASS, "cursor-grab active:cursor-grabbing")}
    >
      <BoardGrip />
      <p className="flex min-w-0 pe-10">
        <Link
          href={caseHref(row.studentCaseId)}
          prefetch={false}
          draggable={false}
          title={row.studentDisplayName}
          className="t-item block min-w-0 truncate text-fg underline-offset-4 hover:underline"
        >
          {row.studentDisplayName}
        </Link>
      </p>
      {secondLine || curator ? (
        <p className="t-meta flex min-w-0 items-baseline gap-2 pe-8 text-fg-3">
          <span className="min-w-0 flex-1 truncate text-fg-2" title={secondLine || undefined}>{secondLine}</span>
          {curator && next ? <Initials name={curator} size="sm" /> : curator ? (
            <abbr title={curator} className="shrink-0 no-underline">
              {ownerInitials(curator)}
            </abbr>
          ) : null}
        </p>
      ) : null}
      {marks.length > 0 && next ? (
        <p className="flex flex-wrap gap-1 py-px">{marks}</p>
      ) : marks.length > 0 ? (
        <p className="t-meta truncate whitespace-nowrap">
          {marks.flatMap((mark, index) => (index === 0 ? [mark] : [<span key={`dot-${index}`} aria-hidden="true" className="text-fg-3"> · </span>, mark]))}
        </p>
      ) : null}
      <div className="absolute end-0.5 top-0.5">
        <CardMenu row={row} tab={tab} onMove={onMove} />
      </div>
    </article>
  );
}

export function AdmissionsPipelineBoard({
  rows,
  truncated,
  boardUnavailable,
  tab,
  query,
  basePath = "/v3/admissions-pipeline",
  look,
}: Readonly<{
  rows: readonly AdmissionsPipelineRow[];
  truncated: boolean;
  boardUnavailable: boolean;
  tab: AdmissionsPipelineTab;
  query: Readonly<{ q: string | null; country: string | null; curator: string | null }>;
  basePath?: string;
  /** Новый облик (Э1.3, предпросмотр Admin): инициалы и чипы в карточках. */
  look?: V3Look;
}>) {
  const next = isNextLook(look);
  const router = useRouter();
  const idPrefix = useId();
  const [retrying, startRetry] = useTransition();
  const [cards, setCards] = useState(rows);
  const [error, setError] = useState<string | null>(null);
  const [removal, setRemoval] = useState<RemovalNotice | null>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const [dragOverStage, setDragOverStage] = useState<AdmissionsPipelineStage | null>(null);
  const [crossTabHint, setCrossTabHint] = useState<CrossTabHint | null>(null);
  const [narrowStage, setNarrowStage] = useState<AdmissionsPipelineStage>(ADMISSIONS_PIPELINE_TAB_STAGES[tab][0]);
  const [, startTransition] = useTransition();

  // Re-derive local (optimistic) state from fresh server props during render
  // — not in a useEffect — the pattern react.dev recommends for "adjusting
  // state when a prop changes": React applies both setState calls before the
  // browser paints, with no extra visible render pass.
  const [previousRows, setPreviousRows] = useState(rows);
  if (rows !== previousRows) {
    setPreviousRows(rows);
    setCards(rows);
  }
  const [previousTab, setPreviousTab] = useState(tab);
  if (tab !== previousTab) {
    setPreviousTab(tab);
    setNarrowStage(ADMISSIONS_PIPELINE_TAB_STAGES[tab][0]);
  }

  // A confirmed removal takes its card (and the menu that had focus) out of the
  // DOM; keep keyboard focus on the outcome and its «Вернуть в воронку» instead
  // of dropping it to <body>. Focus the user already moved elsewhere is kept.
  useEffect(() => {
    if (!removal) return;
    const active = document.activeElement;
    if (!active || active === document.body) noticeRef.current?.focus();
  }, [removal]);

  // Инициалы куратора различают дела, только когда кураторов на доске
  // несколько и фильтр «Куратор» не выбран.
  const showCurator = query.curator === null
    && new Set(cards.map((row) => row.currentCuratorMembershipId).filter(Boolean)).size > 1;
  const tabStages = ADMISSIONS_PIPELINE_TAB_STAGES[tab];
  const boardEmpty = cards.length === 0;

  // A later removal owns the notice: an earlier one finishing must not
  // overwrite it.
  function updateRemoval(studentCaseId: string, next: RemovalNotice | null) {
    setRemoval((current) => (current?.row.studentCaseId === studentCaseId ? next : current));
  }

  function moveCard(studentCaseId: string, target: MoveTarget) {
    const previousRow = cards.find((row) => row.studentCaseId === studentCaseId);
    if (!previousRow) return;
    const previousStage = previousRow.pipelineStage;
    if (!target.remove && target.stage === previousStage) return;
    setError(null);
    setCrossTabHint(null);
    if (target.remove) setRemoval({ row: previousRow, phase: "removing" });
    setCards((current) => target.remove
      ? current.filter((row) => row.studentCaseId !== studentCaseId)
      : current.map((row) => (row.studentCaseId === studentCaseId ? { ...row, pipelineStage: target.stage } : row)));
    const requestId = crypto.randomUUID();
    startTransition(() => {
      void moveCasePipelineAction(
        target.remove
          ? { studentCaseId, requestId, remove: true }
          : { studentCaseId, requestId, stage: target.stage },
      ).catch(() => NO_RESPONSE).then((result) => {
        if (result.status !== "saved") {
          // Revert only the moved card: a whole-board snapshot restore would
          // silently wipe concurrent moves that already succeeded.
          setCards((current) => {
            const stillThere = current.some((row) => row.studentCaseId === studentCaseId);
            if (target.remove && !stillThere) {
              return [...current, previousRow];
            }
            return current.map((row) =>
              row.studentCaseId === studentCaseId ? { ...row, pipelineStage: previousStage } : row,
            );
          });
          if (target.remove) updateRemoval(studentCaseId, null);
          setError(MESSAGES[result.status]);
          return;
        }
        if (target.remove) {
          updateRemoval(studentCaseId, { row: previousRow, phase: "removed" });
          return;
        }
        if (admissionsPipelineTabOf(previousStage) !== admissionsPipelineTabOf(target.stage)) {
          setCrossTabHint({
            studentCaseId,
            tab: admissionsPipelineTabOf(target.stage),
            name: previousRow.studentDisplayName,
            stage: target.stage,
          });
        }
      });
    });
  }

  function restoreRemoved(row: AdmissionsPipelineRow) {
    const { studentCaseId } = row;
    setError(null);
    setRemoval({ row, phase: "restoring" });
    const requestId = crypto.randomUUID();
    startTransition(() => {
      void moveCasePipelineAction({ studentCaseId, requestId, stage: row.pipelineStage }).catch(() => NO_RESPONSE).then((result) => {
        if (result.status !== "saved") {
          updateRemoval(studentCaseId, { row, phase: "removed" });
          setError(MESSAGES[result.status]);
          return;
        }
        setCards((current) => (current.some((card) => card.studentCaseId === studentCaseId) ? current : [...current, row]));
        updateRemoval(studentCaseId, { row, phase: "restored" });
      });
    });
  }

  const tabHref = (nextTab: AdmissionsPipelineTab) =>
    boardHref(basePath, { tab: nextTab, q: query.q, country: query.country, curator: query.curator });

  return (
    <div data-testid="v3-admissions-pipeline-board" className="flex min-w-0 flex-col @5xl:h-full @5xl:min-h-0">
      {error ? (
        <p role="alert" className="t-body-compact mb-2 shrink-0 rounded-ctl border border-danger bg-danger-weak px-3 py-2 text-danger">
          {error}
        </p>
      ) : null}

      <div
        ref={noticeRef}
        tabIndex={-1}
        className={removal || crossTabHint ? "mb-2 flex shrink-0 flex-wrap items-center gap-x-3 rounded-ctl border border-border bg-surface px-3 py-1" : undefined}
      >
        <p role="status" className={removal || crossTabHint ? "t-body-compact min-w-0 flex-1 break-words py-2 text-fg" : undefined}>
          {removal
            ? removalMessage(removal)
            : crossTabHint
              ? `Дело «${crossTabHint.name}» перемещено в «${admissionsPipelineStage(crossTabHint.stage)}».`
              : null}
        </p>
        {removal?.phase === "removed" ? (
          <button type="button" className={btnGhostCls} onClick={() => restoreRemoved(removal.row)}>
            Вернуть в воронку
          </button>
        ) : null}
        {!removal && crossTabHint ? <CrossTabHintLink hint={crossTabHint} tabHref={tabHref} /> : null}
      </div>

      {truncated ? (
        <p className="t-meta mb-2 shrink-0 text-fg-3">Показаны первые 400 дел — уточните поиск.</p>
      ) : null}

      {boardUnavailable ? (
        <div className="space-y-2">
          <p role="alert" className="t-body-compact text-danger">Не удалось загрузить воронку поступления.</p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={retrying}
              onClick={() => startRetry(() => router.refresh())}
              className="inline-flex min-h-11 items-center rounded-ctl border border-control-edge px-3 text-sm font-medium text-fg hover:bg-surface-2 disabled:bg-surface-2 disabled:text-fg-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              {retrying ? "Загрузка…" : "Повторить"}
            </button>
            <Link href="/v3/profile" className="inline-flex min-h-11 items-center text-sm text-accent underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring">
              Открыть студентов
            </Link>
          </div>
        </div>
      ) : boardEmpty ? (
        <p className="t-body-compact px-1 py-10 text-center text-fg-3">Дел в работе нет.</p>
      ) : (
        <>
          {/* Narrow screens: stage picker + single-column list, moves via the card menu only. */}
          <label className="t-label mb-3 flex items-center gap-2 text-fg-2 @5xl:hidden">
            Этап
            <select
              value={narrowStage}
              onChange={(event) => setNarrowStage(event.target.value as AdmissionsPipelineStage)}
              className="min-h-11 flex-1 rounded-ctl border border-control-edge bg-surface px-2.5 text-sm font-normal text-fg"
            >
              {tabStages.map((stage) => (
                <option key={stage} value={stage}>
                  {admissionsPipelineStage(stage)} ({cards.filter((row) => row.pipelineStage === stage).length})
                </option>
              ))}
            </select>
          </label>

          {/* Wide screens: every stage of the tab as a grid column, left-aligned, drag-and-drop between columns. */}
          <div
            role="group"
            aria-label="Воронка поступления"
            className="flex min-w-0 flex-col @5xl:grid @5xl:h-full @5xl:min-h-0 @5xl:grid-rows-[minmax(0,1fr)] @5xl:justify-start @5xl:gap-2"
            style={{ gridTemplateColumns: cappedBoardTracks(tabStages.length) }}
          >
            {tabStages.map((stage) => {
              const inStage = cards.filter((row) => row.pipelineStage === stage);
              return (
                <BoardColumn
                  key={stage}
                  headingId={`${idPrefix}-${stage}`}
                  // Заголовок колонки — слово без точки фазы и в новом облике: на вкладке
                  // одна фаза, точка повторяла бы один цвет над каждой колонкой (правило
                  // плана «колонки не подкрашиваются»); фаза видна на вкладке.
                  title={<span className="truncate">{admissionsPipelineStage(stage)}</span>}
                  count={inStage.length}
                  emptyText={BOARD_EMPTY.cases}
                  testId="v3-admissions-pipeline-column"
                  className={stage === narrowStage ? "flex" : "hidden @5xl:flex"}
                  highlighted={dragOverStage === stage}
                  onDragOver={(event) => { event.preventDefault(); setDragOverStage(stage); }}
                  onDragLeave={() => setDragOverStage((current) => (current === stage ? null : current))}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragOverStage(null);
                    const studentCaseId = event.dataTransfer.getData("text/plain");
                    if (studentCaseId) moveCard(studentCaseId, { stage });
                  }}
                >
                  {inStage.map((row) => (
                    <li key={row.studentCaseId}>
                      <BoardCard row={row} tab={tab} showCurator={showCurator} onMove={(target) => moveCard(row.studentCaseId, target)} next={next} />
                    </li>
                  ))}
                </BoardColumn>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function CrossTabHintLink({
  hint,
  tabHref,
}: Readonly<{
  hint: CrossTabHint;
  tabHref: (tab: AdmissionsPipelineTab) => string;
}>) {
  return (
    <Link
      href={tabHref(hint.tab)}
      prefetch={false}
      className="t-item inline-flex min-h-11 items-center px-1 text-accent-text underline underline-offset-4"
    >
      Открыть в «{admissionsPipelineTab(hint.tab)}»
    </Link>
  );
}
