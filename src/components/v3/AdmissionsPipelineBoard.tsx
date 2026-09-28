"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";

import { btnGhostCls, cn } from "@/components/ui";
import { Icon } from "@/components/icons";
import {
  BOARD_CARD_CLASS,
  BOARD_EMPTY,
  BoardColumn,
  BoardGrip,
  cappedBoardTracks,
} from "@/components/v3/board/Board";
import { TopLayerMenu } from "@/components/v3/board/TopLayerMenu";
import {
  boardUndoOffer,
  placeAfterRefusedUndo,
  type BoardServerPosition,
  type BoardUndoOffer,
} from "@/components/v3/board/board-undo";
import {
  moveCasePipelineAction,
  type MoveCasePipelineActionStatus,
} from "@/lib/platform-admissions-pipeline-actions";
import {
  ADMISSIONS_PIPELINE_TAB_STAGES,
  admissionsNarrowStage,
  admissionsPipelineTabOf,
  type AdmissionsPipelineRow,
  type AdmissionsPipelineStage,
  type AdmissionsPipelineTab,
} from "@/lib/platform-admissions-pipeline-contract";
import { admissionsPipelineStage, admissionsPipelineTab, caseChatAwaitState, country as countryLabel } from "@/lib/v3/wording";
import { Initials } from "@/components/v3/blocks/Initials";
import { StatusChip } from "@/components/v3/blocks/StatusChip";
import { UndoToast } from "@/components/v3/blocks/UndoToast";
import { resumedUndoDeadline } from "@/components/v3/tasks/undo-deadline";

/** Full sentences only — a saved stage move is silent; removal reports below. */
const MESSAGES: Record<Exclude<MoveCasePipelineActionStatus, "saved"> | "no_response", string> = {
  invalid: "Не удалось подготовить перемещение.",
  forbidden: "У вашей роли нет прав на это перемещение.",
  request_conflict: "Команда уже использована. Повторите действие.",
  // 251: «Отменить» и «Вернуть в воронку» идут с версией — дело переместили после нашего перемещения.
  moved: "Дело уже переместили — отмена не выполнена.",
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
 * stage, which clears the hide server-side — no new server semantics. Since
 * 251 it carries the version of the removal receipt: someone else's later move
 * of the case is never overwritten.
 */
type RemovalNotice = Readonly<{
  row: AdmissionsPipelineRow;
  phase: "removing" | "removed" | "restoring" | "restored";
  /** Version from the removal receipt (251); null — a receipt without one. */
  version?: number | null;
}>;

/** How the move was made: the menu is the keyboard and phone path — «Отменить» takes focus. */
type MoveVia = "menu" | "drag";

/** A saved move into the other tab leaves this board: say where it went. */
type CrossTabHint = Readonly<{ studentCaseId: string; tab: AdmissionsPipelineTab; name: string; stage: AdmissionsPipelineStage }>;

/**
 * Строка ошибки доски — одна на событие: причина, где дело сейчас (отказ
 * `moved`, 251) и ссылка в другой раздел, если дело теперь там.
 */
type BoardError = Readonly<{ message: string; where?: string | null; hint?: CrossTabHint | null }>;

/** Где дело сейчас по ответу сервера — словами, в той же строке, что отказ. */
function whereNow(name: string, position: BoardServerPosition | null): string | null {
  if (!position) return null;
  return position.hidden
    ? `Сейчас дело «${name}» убрано из воронки.`
    : `Сейчас дело «${name}» — в «${admissionsPipelineStage(position.stage)}».`;
}

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

/** Слова строки уведомлений: основа 16rem — на телефоне кнопка или ссылка уходит под текст, а не сжимает его. */
const NOTICE_TEXT_CLASS = "t-body-compact min-w-0 flex-[1_1_16rem] break-words py-2 text-fg";

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
}: Readonly<{
  row: AdmissionsPipelineRow;
  tab: AdmissionsPipelineTab;
  showCurator: boolean;
  onMove: (target: MoveTarget) => void;
  onDragStart?: () => void;
}>) {
  const secondLine = [countryLabel(row.targetCountry), row.primaryInstitutionName]
    .filter((value): value is string => Boolean(value))
    .join(" · ");
  // Та же грамматика, что у карточки продаж: куратор — круг инициалов справа
  // во второй строке (полное имя в подсказке), состояние — чипы со словом в
  // третьей (Э1.3); дней просрочки нет — чтение доски даты шага не отдаёт.
  const replyWord = caseChatAwaitState("needs_reply")?.toLocaleLowerCase("ru-RU") ?? "";
  const marks = [
    row.overdue ? <StatusChip key="overdue" label="просрочено" tone="danger" size="sm" /> : null,
    row.needsReply ? (
      // Ссылка на переписку дела: чип 18 px, зона нажатия 44 px (`.v3-chip-link`, v3.css).
      <Link key="reply" href={`/v3/messages?case=${row.studentCaseId}`} prefetch={false} draggable={false} className="v3-chip-link inline-flex">
        <StatusChip label={replyWord} tone="danger" size="sm" />
      </Link>
    ) : null,
    row.awaitingAck ? <StatusChip key="ack" label="ждёт принятия" tone="warn" size="sm" /> : null,
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
          {curator ? <Initials name={curator} size="sm" /> : null}
        </p>
      ) : null}
      {marks.length > 0 ? (
        <p className="flex flex-wrap gap-1 py-px">{marks}</p>
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
  requestedStage = null,
}: Readonly<{
  rows: readonly AdmissionsPipelineRow[];
  truncated: boolean;
  boardUnavailable: boolean;
  tab: AdmissionsPipelineTab;
  query: Readonly<{ q: string | null; country: string | null; curator: string | null }>;
  basePath?: string;
  /** `?stage=` адреса: этап, который телефон открывает первым (Э8.11). */
  requestedStage?: string | null;
}>) {
  const router = useRouter();
  const idPrefix = useId();
  const [retrying, startRetry] = useTransition();
  const [cards, setCards] = useState(rows);
  const [error, setError] = useState<BoardError | null>(null);
  const [removal, setRemoval] = useState<RemovalNotice | null>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const [dragOverStage, setDragOverStage] = useState<AdmissionsPipelineStage | null>(null);
  const [crossTabHint, setCrossTabHint] = useState<CrossTabHint | null>(null);
  // Телефон открывает этап из адреса или первый этап с делами, а не пустой
  // первый (Э8.11).
  const [narrowStage, setNarrowStage] = useState<AdmissionsPipelineStage>(() => admissionsNarrowStage(tab, rows, requestedStage));
  // «Отменить» (Э7, 251): одно предложение — последнее подтверждённое
  // перемещение, строкой в верхнем слое (UndoToast); итог отмены — строкой
  // уведомлений доски.
  const [undo, setUndo] = useState<BoardUndoOffer | null>(null);
  const [undoNote, setUndoNote] = useState<string | null>(null);
  const [held, setHeld] = useState(false);
  const heldSince = useRef<number | null>(null);
  // Куда поставить фокус после ответа на «Отменить» или «Вернуть в воронку»:
  // карточка там, где её положение назвал сервер. Ставится после отрисовки,
  // когда карточка уже на своём месте.
  const [refocus, setRefocus] = useState<Readonly<{ studentCaseId: string }> | null>(null);
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
    setNarrowStage(admissionsNarrowStage(tab, rows, requestedStage));
  }

  // A confirmed removal takes its card (and the menu that had focus) out of the
  // DOM; keep keyboard focus on the outcome and its «Вернуть в воронку» instead
  // of dropping it to <body>. Focus the user already moved elsewhere is kept.
  useEffect(() => {
    if (!removal) return;
    const active = document.activeElement;
    if (!active || active === document.body) noticeRef.current?.focus();
  }, [removal]);

  // «Отменить» держится около 6 секунд; пока на строке фокус или указатель,
  // срок стоит (WCAG 2.2.1) и идёт дальше, когда они ушли. Идущая отмена
  // не истекает.
  useEffect(() => {
    if (!undo || undo.pending || held) return;
    const timer = window.setTimeout(() => {
      setUndo((current) => (current?.key === undo.key ? null : current));
    }, Math.max(0, undo.expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [undo, held]);

  const hold = useCallback((nextHeld: boolean) => {
    if (nextHeld) {
      if (heldSince.current !== null) return;
      heldSince.current = Date.now();
      setHeld(true);
      return;
    }
    const since = heldSince.current;
    if (since === null) return;
    heldSince.current = null;
    const now = Date.now();
    setUndo((current) => (current ? { ...current, expiresAt: resumedUndoDeadline(current, since, now) } : current));
    setHeld(false);
  }, []);

  // Строка ушла вместе с фокусом или под указателем — пауза снимается.
  useEffect(() => {
    if (!undo) hold(false);
  }, [undo, hold]);

  useEffect(() => {
    if (!refocus) return;
    // Карточка там, где её назвал сервер; её не видно (другой раздел) — ссылка
    // «Открыть в «…»» в строке итога; нет и её (дело убрано) — сама строка.
    const targets = [
      document.querySelector<HTMLElement>(
        `[data-testid="v3-admissions-pipeline-card"][data-student-case-id="${CSS.escape(refocus.studentCaseId)}"] a`),
      errorRef.current?.querySelector<HTMLElement>("a") ?? null,
      errorRef.current,
      noticeRef.current?.textContent ? noticeRef.current : null,
    ];
    for (const target of targets) {
      target?.focus();
      if (target && document.activeElement === target) return;
    }
  }, [refocus]);

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

  /**
   * Фокус был на «Отменить», «Вернуть в воронку» или строке итога (или
   * потерян): эти строки уходят с ответом, фокус нужно поставить заново.
   */
  function focusInOutcome(): boolean {
    const active = document.activeElement;
    return !active || active === document.body
      || Boolean(noticeRef.current?.contains(active) || errorRef.current?.contains(active))
      || Boolean(active.closest("[data-testid='v3-undo-toasts']"));
  }

  /**
   * Ответ сервера поставил карточку на этап этого раздела — телефон показывает
   * этот этап, и адрес называет его (Э8.11).
   */
  function showStage(stage: AdmissionsPipelineStage) {
    if (admissionsPipelineTabOf(stage) === tab) chooseNarrowStage(stage);
  }

  /**
   * Этап телефона пишется в адрес (`?stage=`) без запроса к серверу — и
   * выбранный в списке, и тот, за которым список последовал после ответа
   * сервера: обновление страницы открывает тот же этап (Э8.11).
   */
  function chooseNarrowStage(next: AdmissionsPipelineStage) {
    setNarrowStage(next);
    const search = new URLSearchParams(window.location.search);
    search.set("stage", next);
    window.history.replaceState(null, "", `${window.location.pathname}?${search.toString()}`);
  }

  /**
   * Отказ одной строкой: причина, где дело сейчас (`position` — только то, что
   * назвал сервер) и ссылка в другой раздел, если карточка теперь там
   * (`placed` — где она стоит на доске после ответа).
   */
  function refusal(
    message: string,
    name: string,
    studentCaseId: string,
    position: BoardServerPosition | null,
    placed: BoardServerPosition | null = position,
  ): BoardError {
    const hint = placed && !placed.hidden && admissionsPipelineTabOf(placed.stage) !== tab
      ? { studentCaseId, tab: admissionsPipelineTabOf(placed.stage), name, stage: placed.stage }
      : null;
    return { message, where: whereNow(name, position), hint };
  }

  function moveCard(studentCaseId: string, target: MoveTarget, via: MoveVia) {
    const previousRow = cards.find((row) => row.studentCaseId === studentCaseId);
    if (!previousRow) return;
    const previousStage = previousRow.pipelineStage;
    if (!target.remove && target.stage === previousStage) return;
    setError(null);
    setCrossTabHint(null);
    // Новое перемещение заменяет прежнюю строку «Отменить».
    setUndo(null);
    setUndoNote(null);
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
          setError({ message: MESSAGES[result.status] });
          return;
        }
        if (target.remove) {
          updateRemoval(studentCaseId, {
            row: previousRow, phase: "removed", version: typeof result.pipelineVersion === "number" ? result.pipelineVersion : null,
          });
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
        // «Отменить» — только с версией из квитанции: без неё отмена могла бы
        // затереть чужое перемещение (квитанция прежней команды v1 её не несёт).
        if (typeof result.pipelineVersion === "number" && result.pipelineStage === target.stage) {
          setUndo(boardUndoOffer({
            key: requestId, row: previousRow, toStage: target.stage, version: result.pipelineVersion, focus: via === "menu",
          }, Date.now()));
        }
      });
    });
  }

  function undoMove(offer: BoardUndoOffer) {
    if (offer.pending) return;
    const { studentCaseId, studentDisplayName: name, pipelineStage: fromStage } = offer.row;
    const hadFocus = focusInOutcome();
    setError(null);
    setUndoNote(null);
    // Карточка стоит, где стоит, пока сервер не ответил: отмена может не
    // пройти (дело переместили), и карточка не прыгает туда и обратно.
    // Ожидание несёт сама «Отменить» (недоступна до ответа).
    setUndo((current) => (current?.key === offer.key ? { ...current, pending: true } : current));
    const requestId = crypto.randomUUID();
    startTransition(() => {
      void moveCasePipelineAction({ studentCaseId, requestId, stage: fromStage, expectedVersion: offer.version })
        .catch(() => NO_RESPONSE).then((result) => {
          setUndo((current) => (current?.key === offer.key ? null : current));
          if (result.status === "saved") {
            // Позднее перечитывание доски (от самого перемещения) могло вернуть
            // карточку на прежнее место — ставим её туда, где она по квитанции.
            setCards((current) => current.map((row) => (row.studentCaseId === studentCaseId ? { ...row, pipelineStage: fromStage } : row)));
            setCrossTabHint((hint) => (hint?.studentCaseId === studentCaseId ? null : hint));
            setUndoNote(`Перемещение отменено: дело «${name}» снова в «${admissionsPipelineStage(fromStage)}».`);
            showStage(fromStage);
            if (hadFocus) setRefocus({ studentCaseId });
            return;
          }
          // Не отменено: карточка там, где её положение назвал сервер (дело
          // переместили), иначе — где её оставило подтверждённое перемещение.
          const position = result.status === "moved" && "pipelineStage" in result
            && result.pipelineStage !== null && result.pipelineHidden !== null
            ? { stage: result.pipelineStage, hidden: result.pipelineHidden }
            : null;
          setCards((current) => placeAfterRefusedUndo(current, offer, position));
          // Одна строка итога: причина, где дело сейчас (только по словам
          // сервера) и ссылка в другой раздел, если карточка теперь там.
          const placed = position ?? { stage: offer.toStage, hidden: false };
          setCrossTabHint(null);
          setError(refusal(MESSAGES[result.status], name, studentCaseId, position, placed));
          if (!placed.hidden) showStage(placed.stage);
          if (hadFocus) setRefocus({ studentCaseId });
        });
    });
  }

  function restoreRemoved(notice: RemovalNotice) {
    const { row } = notice;
    const { studentCaseId } = row;
    const hadFocus = focusInOutcome();
    setError(null);
    setUndo(null);
    setUndoNote(null);
    setRemoval({ ...notice, phase: "restoring" });
    const requestId = crypto.randomUUID();
    const expected = typeof notice.version === "number" ? { expectedVersion: notice.version } : {};
    startTransition(() => {
      void moveCasePipelineAction({ studentCaseId, requestId, stage: row.pipelineStage, ...expected }).catch(() => NO_RESPONSE).then((result) => {
        if (result.status === "moved") {
          // Дело уже вернули или переместили: строка «Вернуть» уходит, карточка —
          // там, где её положение назвал сервер (или остаётся вне доски).
          updateRemoval(studentCaseId, null);
          const position = result.pipelineStage !== null && result.pipelineHidden !== null
            ? { stage: result.pipelineStage, hidden: result.pipelineHidden }
            : null;
          if (position && !position.hidden) {
            const { stage } = position;
            setCards((current) => (current.some((card) => card.studentCaseId === studentCaseId)
              ? current.map((card) => (card.studentCaseId === studentCaseId ? { ...card, pipelineStage: stage } : card))
              : [...current, { ...row, pipelineStage: stage }]));
            showStage(stage);
          }
          setError(refusal(MESSAGES.moved, row.studentDisplayName, studentCaseId, position));
          if (hadFocus) setRefocus({ studentCaseId });
          return;
        }
        if (result.status !== "saved") {
          updateRemoval(studentCaseId, { ...notice, phase: "removed" });
          setError({ message: MESSAGES[result.status] });
          return;
        }
        setCards((current) => (current.some((card) => card.studentCaseId === studentCaseId) ? current : [...current, row]));
        updateRemoval(studentCaseId, { row, phase: "restored" });
      });
    });
  }

  const tabHref = (nextTab: AdmissionsPipelineTab) =>
    boardHref(basePath, { tab: nextTab, q: query.q, country: query.country, curator: query.curator });

  // Строка уведомлений доски — две независимые строки: удаление с «Вернуть в
  // воронку» и перемещение (переход в другой раздел, итог отмены).
  // «Отменить» — строкой в верхнем слое (UndoToast), а слова перемещения
  // здесь — только для читалки, пока нет ссылки на другой раздел. У каждой
  // строки своя вежливая живая область.
  const moved = undo
    ? { name: undo.row.studentDisplayName, stage: undo.toStage }
    : crossTabHint;
  const movedText = moved ? `Дело «${moved.name}» перемещено в «${admissionsPipelineStage(moved.stage)}».` : null;
  const moveText = undoNote ?? movedText;
  const moveShown = Boolean(crossTabHint || undoNote);
  // Строка называет дело, как «Задачи» свою задачу: карточка ушла с видимого
  // этапа (телефон) или после перетаскивания её не видно среди других.
  const toasts = undo && movedText
    ? [{
        key: undo.key,
        message: movedText,
        pending: undo.pending,
        error: null,
        focus: undo.focus,
        onUndo: () => undoMove(undo),
      }]
    : [];

  return (
    <div data-testid="v3-admissions-pipeline-board" className="flex min-w-0 flex-col @5xl:h-full @5xl:min-h-0">
      {error ? (
        // Одна строка на событие: причина, где дело сейчас и ссылка туда.
        // Фокус сюда — только когда карточки и ссылки нет; рамка самой строки
        // и есть отметка, без кольца браузера.
        <div
          ref={errorRef}
          tabIndex={-1}
          role="alert"
          className="mb-2 flex shrink-0 flex-wrap items-center gap-x-3 rounded-ctl border border-danger bg-danger-weak px-3 outline-none"
        >
          <p className="t-body-compact min-w-0 flex-[1_1_16rem] break-words py-2 text-danger">
            {error.where ? `${error.message} ${error.where}` : error.message}
          </p>
          {error.hint ? <CrossTabHintLink hint={error.hint} tabHref={tabHref} /> : null}
        </div>
      ) : null}

      <div
        ref={noticeRef}
        tabIndex={-1}
        className={cn(
          // Кольцо фокуса — токены доски (`--focus-ring`, `--focus-halo`), не браузера.
          "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring focus-visible:shadow-[0_0_0_3px_var(--focus-halo)]",
          (removal || moveShown) && "mb-2 flex shrink-0 flex-col rounded-ctl border border-border bg-surface px-3 py-1",
        )}
      >
        <div className={removal ? "flex flex-wrap items-center gap-x-3" : undefined}>
          <p role="status" className={removal ? NOTICE_TEXT_CLASS : undefined}>
            {removal ? removalMessage(removal) : null}
          </p>
          {removal?.phase === "removed" ? (
            <button type="button" className={btnGhostCls} onClick={() => restoreRemoved(removal)}>
              Вернуть в воронку
            </button>
          ) : null}
        </div>
        <div className={moveShown ? "flex flex-wrap items-center gap-x-3" : undefined}>
          <p role="status" className={moveShown ? NOTICE_TEXT_CLASS : moveText ? "sr-only" : undefined}>
            {moveText}
          </p>
          {crossTabHint && !undoNote ? <CrossTabHintLink hint={crossTabHint} tabHref={tabHref} /> : null}
        </div>
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
              onChange={(event) => chooseNarrowStage(event.target.value as AdmissionsPipelineStage)}
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
                  // Заголовок колонки — слово без точки фазы: на вкладке одна фаза, точка
                  // повторяла бы один цвет над каждой колонкой (правило плана «колонки не
                  // подкрашиваются»); фаза видна на вкладке.
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
                    if (studentCaseId) moveCard(studentCaseId, { stage }, "drag");
                  }}
                >
                  {inStage.map((row) => (
                    <li key={row.studentCaseId}>
                      <BoardCard row={row} tab={tab} showCurator={showCurator} onMove={(target) => moveCard(row.studentCaseId, target, "menu")} />
                    </li>
                  ))}
                </BoardColumn>
              );
            })}
          </div>
        </>
      )}
      {/* «Отменить» строкой в верхнем слое (блок Э1.3). Последним — как у «Задач». */}
      <UndoToast items={toasts} onHold={hold} />
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
