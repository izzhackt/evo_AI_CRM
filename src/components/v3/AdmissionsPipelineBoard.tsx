"use client";

import Link from "next/link";
import { useState } from "react";

import { btnGhostCls, cn } from "@/components/ui";
import {
  BOARD_CARD_CLASS,
  BOARD_EMPTY,
  BoardColumn,
  BoardGrip,
  cappedBoardTracks,
} from "@/components/v3/board/Board";
import { AdmissionsCardMenu } from "@/components/v3/admissions-board/AdmissionsCardMenu";
import { caseHref, removalMessage, type CrossTabHint, type MoveTarget } from "@/components/v3/admissions-board/board-model";
import { useAdmissionsBoard } from "@/components/v3/admissions-board/useAdmissionsBoard";
import {
  type AdmissionsPipelineRow,
  type AdmissionsPipelineStage,
  type AdmissionsPipelineTab,
} from "@/lib/platform-admissions-pipeline-contract";
import { admissionsPipelineStage, admissionsPipelineTab, caseChatAwaitState, country as countryLabel } from "@/lib/v3/wording";
import { Initials } from "@/components/v3/blocks/Initials";
import { StatusChip } from "@/components/v3/blocks/StatusChip";
import { UndoToast } from "@/components/v3/blocks/UndoToast";

/** Слова строки уведомлений: основа 16rem — на телефоне кнопка или ссылка уходит под текст, а не сжимает его. */
const NOTICE_TEXT_CLASS = "t-body-compact min-w-0 flex-[1_1_16rem] break-words py-2 text-fg";

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
  // «нужен ответ» — предупреждение, как в обзоре дела и в «Переписке» (Э5, решение
  // владельца 24.10.2026): красным остаётся только «просрочено».
  const replyWord = caseChatAwaitState("needs_reply")?.toLocaleLowerCase("ru-RU") ?? "";
  const marks = [
    row.overdue ? <StatusChip key="overdue" label="просрочено" tone="danger" size="sm" /> : null,
    row.needsReply ? (
      // Ссылка на переписку дела: чип 18 px, зона нажатия 44 px (`.v3-chip-link`, v3.css).
      <Link key="reply" href={`/v3/messages?case=${row.studentCaseId}`} prefetch={false} draggable={false} className="v3-chip-link inline-flex">
        <StatusChip label={replyWord} tone="warn" size="sm" />
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
          className="t-item block min-w-0 line-clamp-2 break-words text-fg underline-offset-4 hover:underline"
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
        <AdmissionsCardMenu row={row} tab={tab} onMove={onMove} />
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
  const {
    cards, error, errorRef, noticeRef, removal, restoreRemoved, moveShown, moveText, crossTabHint, undoNote, tabHref, retrying, retry, boardEmpty,
    narrowStage, chooseNarrowStage, tabStages, idPrefix, moveCard, showCurator, toasts, hold,
  } = useAdmissionsBoard({ rows, tab, query, basePath, requestedStage });
  const [dragOverStage, setDragOverStage] = useState<AdmissionsPipelineStage | null>(null);

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
              onClick={retry}
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
        <p className="t-body-compact px-1 py-10 text-center text-fg-3">
          {query.q !== null || query.country !== null || query.curator !== null ? "Ничего не найдено." : "Дел в работе нет."}
        </p>
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
                  // Телефон: этап назван выбором «Этап» над списком — заголовок колонки повторял бы его.
                  className={stage === narrowStage ? "flex @max-5xl:[&>header]:hidden" : "hidden @5xl:flex"}
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
