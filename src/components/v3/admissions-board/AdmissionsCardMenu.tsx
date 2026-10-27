"use client";

import { useEffect, useId, useRef, useState } from "react";

import { Icon } from "@/components/icons";
import { cn } from "@/components/ui";
import { TopLayerMenu } from "@/components/v3/board/TopLayerMenu";
import type { MoveTarget } from "@/components/v3/admissions-board/board-model";
import { ADMISSIONS_PIPELINE_TAB_STAGES, type AdmissionsPipelineRow, type AdmissionsPipelineTab } from "@/lib/platform-admissions-pipeline-contract";
import { admissionsPipelineStage, admissionsPipelineTab } from "@/lib/v3/wording";

const MENU_ITEM_CLASS = "flex min-h-11 w-full items-center rounded-nav px-2 text-left text-sm text-fg hover:bg-surface-2";

/**
 * «Действия с делом» — меню в top layer (`TopLayerMenu`): колонка с
 * `overflow-y-auto` больше не обрезает его до первой строки. Сначала этапы
 * текущего раздела, этапы другого раздела — за его названием, отдельно
 * «Убрать из воронки» с подтверждением. «Открыть дело» в меню нет: дело
 * открывает имя на карточке.
 */
export function AdmissionsCardMenu({ row, tab, onMove }: Readonly<{
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
      label={`Действия с делом: ${row.studentDisplayName}`}
      menuLabel="Действия с делом"
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
            {admissionsPipelineTab(otherTab)}
            <Icon name="chevron-down" size={16} className={cn("shrink-0 text-fg-3", otherOpen && "rotate-180")} />
          </button>
          <div id={otherId} hidden={!otherOpen} role="group" aria-label={admissionsPipelineTab(otherTab)}>
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
