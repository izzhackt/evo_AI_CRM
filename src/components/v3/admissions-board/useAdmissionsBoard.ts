import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";

import {
  MESSAGES,
  NO_RESPONSE,
  boardHref,
  whereNow,
  type BoardError,
  type CrossTabHint,
  type MoveTarget,
  type MoveVia,
  type RemovalNotice,
} from "@/components/v3/admissions-board/board-model";
import {
  boardUndoOffer,
  placeAfterRefusedUndo,
  type BoardServerPosition,
  type BoardUndoOffer,
} from "@/components/v3/board/board-undo";
import { resumedUndoDeadline } from "@/components/v3/tasks/undo-deadline";
import { moveCasePipelineAction } from "@/lib/platform-admissions-pipeline-actions";
import {
  ADMISSIONS_PIPELINE_TAB_STAGES,
  admissionsNarrowStage,
  admissionsPipelineTabOf,
  type AdmissionsPipelineRow,
  type AdmissionsPipelineStage,
  type AdmissionsPipelineTab,
} from "@/lib/platform-admissions-pipeline-contract";
import { admissionsPipelineStage } from "@/lib/v3/wording";

export type AdmissionsBoardProps = Readonly<{
  rows: readonly AdmissionsPipelineRow[];
  tab: AdmissionsPipelineTab;
  query: Readonly<{ q: string | null; country: string | null; curator: string | null }>;
  basePath?: string;
  /** `?stage=` адреса: этап, который телефон открывает первым (Э8.11). */
  requestedStage?: string | null;
}>;

/**
 * Движок доски поступления: оптимистичные перемещения (`moveCasePipelineAction`), «Отменить» со сроком и паузой, «Убрать из воронки» с
 * «Вернуть», отказы одной строкой, возврат фокуса и этап телефона в адресе. Вынесен из `AdmissionsPipelineBoard.tsx` без изменений
 * логики: прежний и новый вид рисуют одно и то же состояние и зовут одни и те же серверные действия.
 */
export function useAdmissionsBoard({ rows, tab, query, basePath = "/v3/admissions-pipeline", requestedStage = null }: AdmissionsBoardProps) {
  const router = useRouter();
  const idPrefix = useId();
  const [retrying, startRetry] = useTransition();
  const [cards, setCards] = useState(rows);
  const [error, setError] = useState<BoardError | null>(null);
  const [removal, setRemoval] = useState<RemovalNotice | null>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
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
   * сервера: обновление страницы открывает тот же этап (Э8.11). Ответ мог
   * прийти, когда сотрудник уже ушёл с доски: чужой адрес (в «Студентах»
   * `?stage=` — фильтр «Этап») не трогаем.
   */
  function chooseNarrowStage(next: AdmissionsPipelineStage) {
    setNarrowStage(next);
    if (window.location.pathname !== basePath) return;
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

  return {
    cards, error, errorRef, noticeRef, removal, restoreRemoved, moveShown, moveText, crossTabHint, undoNote, tabHref, retrying, boardEmpty,
    retry: () => startRetry(() => router.refresh()),
    narrowStage, chooseNarrowStage, tabStages, idPrefix, moveCard, showCurator, toasts, hold,
  };
}
