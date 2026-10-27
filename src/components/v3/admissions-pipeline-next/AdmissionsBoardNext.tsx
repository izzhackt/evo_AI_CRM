"use client";

import { DndContext, DragOverlay, MouseSensor, TouchSensor, pointerWithin, useSensor, useSensors, type Announcements, type DragEndEvent } from "@dnd-kit/core";
import Link from "next/link";
import { useState } from "react";

import { EmptyState } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { AdmissionsCardBody } from "@/components/v3/admissions-pipeline-next/AdmissionsCardNext";
import { AdmissionsColumnNext } from "@/components/v3/admissions-pipeline-next/AdmissionsColumnNext";
import { AdmissionsNotices } from "@/components/v3/admissions-pipeline-next/AdmissionsNotices";
import { useAdmissionsBoard, type AdmissionsBoardProps } from "@/components/v3/admissions-board/useAdmissionsBoard";
import { UndoToast } from "@/components/v3/blocks/UndoToast";
import { BOARD_CARD_CLASS } from "@/components/v3/board/Board";
import type { AdmissionsPipelineStage } from "@/lib/platform-admissions-pipeline-contract";
import { admissionsPipelineStage } from "@/lib/v3/wording";

/**
 * Объявления перетаскивания для читалки — по-русски. Итог перемещения («перемещено в …») говорит строка уведомлений доски, не дублируем;
 * отпущенное мимо колонок дело никуда не двигается, и об этом сказано, а не оставлено «взято».
 */
const ANNOUNCEMENTS: Announcements = {
  onDragStart: ({ active }) => `Дело «${String(active.data.current?.name ?? "")}» взято.`,
  onDragOver: ({ over }) => (over ? `Над этапом «${String(over.data.current?.title ?? "")}».` : undefined),
  onDragMove: () => undefined,
  onDragEnd: ({ over }) => (over ? undefined : "Перемещение отменено."),
  onDragCancel: () => "Перемещение отменено.",
};

/**
 * Доска поступления нового вида: движок прежней доски (`useAdmissionsBoard`: перемещения, «Отменить», «Убрать», отказы, фокус) и
 * новая раскладка — колонки-карточки набора, перетаскивание `@dnd-kit/core`, выбор этапа на телефоне.
 */
export function AdmissionsBoardNext(props: AdmissionsBoardProps & Readonly<{ truncated: boolean; boardUnavailable: boolean }>) {
  const { tab, query, truncated, boardUnavailable } = props;
  const board = useAdmissionsBoard(props);
  const [dragging, setDragging] = useState<string | null>(null);
  const sensors = useSensors(
    // Нажатие на имя и «⋯» остаётся нажатием: мышью перетаскивание начинается после 6 px. Палец — после удержания 250 мс; сдвиг раньше —
    // это прокрутка страницы, и дело не берётся. Именно мышь и касание, а не `PointerSensor`: он перехватывает и касание (событие
    // `pointerdown` приходит раньше `touchstart`), и тогда браузер забирает жест на прокрутку и отменяет перетаскивание.
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDragging(null);
    if (over) board.moveCard(String(active.id), { stage: over.id as AdmissionsPipelineStage }, "drag");
  };
  const active = board.cards.find((row) => row.studentCaseId === dragging) ?? null;
  const empty = query.q !== null || query.country !== null || query.curator !== null ? "Ничего не найдено." : "Дел в работе нет.";
  return (
    <div data-testid="v3-admissions-pipeline-board" className="flex min-w-0 flex-col">
      <AdmissionsNotices error={board.error} errorRef={board.errorRef} noticeRef={board.noticeRef} removal={board.removal} moveShown={board.moveShown}
        moveText={board.moveText} crossTabHint={board.crossTabHint} undoNote={board.undoNote} tabHref={board.tabHref} onRestore={board.restoreRemoved} />
      {truncated ? <p className="t-meta mb-3 text-fg-3">Показаны первые 400 дел — уточните поиск.</p> : null}
      {boardUnavailable ? (
        <div role="alert" className="grid justify-items-start gap-3 rounded-card border border-danger bg-danger-weak p-4">
          <p className="t-body-compact text-danger">Не удалось загрузить воронку поступления.</p>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" disabled={board.retrying} onClick={board.retry}>{board.retrying ? "Загрузка…" : "Повторить"}</Button>
            <Link href="/v3/profile" className="t-item inline-flex min-h-11 items-center text-accent-text underline underline-offset-4">Открыть студентов</Link>
          </div>
        </div>
      ) : board.boardEmpty ? (
        <div className="rounded-card border border-border bg-card"><EmptyState title={empty} /></div>
      ) : (
        <>
          <label className="t-label mb-3 flex items-center gap-2 text-fg-2 @5xl:hidden">
            Этап
            <select value={board.narrowStage} onChange={(event) => board.chooseNarrowStage(event.target.value as AdmissionsPipelineStage)}
              className="h-11 min-w-0 flex-1 rounded-ctl border border-input bg-surface px-2.5 text-base font-normal text-fg">
              {board.tabStages.map((stage) => (
                <option key={stage} value={stage}>{admissionsPipelineStage(stage)} ({board.cards.filter((row) => row.pipelineStage === stage).length})</option>
              ))}
            </select>
          </label>
          <DndContext sensors={sensors} collisionDetection={pointerWithin} accessibility={{ announcements: ANNOUNCEMENTS }}
            onDragStart={({ active: item }) => setDragging(String(item.id))} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
            <div role="group" aria-label="Воронка поступления" className="grid min-w-0 gap-3 @5xl:[grid-template-columns:repeat(var(--board-cols),minmax(0,1fr))]"
              style={{ "--board-cols": board.tabStages.length } as React.CSSProperties}>
              {board.tabStages.map((stage) => (
                <AdmissionsColumnNext key={stage} stage={stage} tab={tab} showCurator={board.showCurator} visibleNarrow={stage === board.narrowStage}
                  rows={board.cards.filter((row) => row.pipelineStage === stage)} onMove={(studentCaseId, target) => board.moveCard(studentCaseId, target, "menu")} />
              ))}
            </div>
            <DragOverlay dropAnimation={null}>
              {active ? <article className={`${BOARD_CARD_CLASS} cursor-grabbing shadow-evo-lg`}><AdmissionsCardBody row={active} showCurator={board.showCurator} /></article> : null}
            </DragOverlay>
          </DndContext>
        </>
      )}
      <UndoToast items={board.toasts} onHold={board.hold} />
    </div>
  );
}
