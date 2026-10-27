"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { DataTable, EmptyState } from "@/components/kit";
import { Button } from "@/components/ui/button";
import type { DialOptions } from "@/lib/v3/telephony-dial";
import type { QueueTask } from "@/lib/v3/task-queue";

import { UndoToast } from "../../blocks/UndoToast";
import { useQueueKeyboard } from "../../queue/useQueueKeyboard";
import { type QueueParams } from "../../queue/queue-url";
import { DialListHint } from "../../telephony/DialButton";
import { TaskBulkActions } from "../TaskBulkActions";
import { taskPanelHref } from "../TaskQueueList";
import type { TaskRowPermissions } from "../TaskQueueRow";
import { useRecentCompletions, useUndoToasts } from "../useRecentCompletions";
import { TaskFilterBar } from "./TaskFilterBar";
import { TaskSheetHost, type TaskSheetData } from "./TaskSheetHost";
import { TaskTableProvider, type TaskTableValue } from "./TaskTableContext";
import { taskColumns } from "./task-columns";
import type { TaskFilterBarData } from "./task-filter-menus";
import { sameTaskRows, taskRows, type TaskBand, type TaskLead, type TaskRow } from "./task-table-model";
import { useTaskBulk } from "./useTaskBulk";

const PAGE_SIZE = 25;

/** Клавиши очереди (j/k, «x») живут, пока панель задачи закрыта: открытая панель держит фокус внутри себя. */
function QueueKeys() {
  useQueueKeyboard({ openKey: null });
  return null;
}

/** Строки не меняются (ключ, версия, порядок) — таблица получает прежний массив и не сбрасывает страницу. */
function useStableRows(next: TaskRow[]): TaskRow[] {
  const [stable, setStable] = useState(next);
  if (stable !== next && !sameTaskRows(stable, next)) {
    setStable(next);
    return next;
  }
  return stable;
}

/**
 * Список «Задач» в «Новом виде»: `DataTable` с прежними фильтрами (адрес), быстрым завершением рабочей задачи с
 * «Отменить», массовым выбором и панелью задачи (`TaskSheetHost`) с прежними формами. Данные, права и команды
 * читает и проверяет страница и сервер; таблица только показывает их.
 */
export function TasksTable({
  bands, open, listParams, showAssignee, nowIso, permissions, leads, dial, filterBar, empty, partial, sheet, closeHref, moveOpen,
}: Readonly<{
  bands: readonly TaskBand[];
  open: boolean;
  listParams: QueueParams;
  showAssignee: boolean;
  nowIso: string;
  permissions: TaskRowPermissions;
  leads: Readonly<Record<string, TaskLead>> | null;
  dial: DialOptions | null;
  filterBar: TaskFilterBarData;
  empty: Readonly<{ title: string; action: Readonly<{ label: string; href: string }> | null }>;
  /** Чтение неполное: таблица не называет общее число («1–25», а не «1–25 из 50»). */
  partial: boolean;
  sheet: TaskSheetData | null;
  closeHref: string;
  moveOpen: boolean;
}>) {
  const router = useRouter();
  const { recent, message, announce, undo, completed, shown, hold } = useRecentCompletions(bands);
  const toasts = useUndoToasts(recent, undo);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const setError = useCallback((key: string, text: string | null) => setErrors((current) => {
    const next = { ...current };
    if (text) next[key] = text; else delete next[key];
    return next;
  }), []);
  const rows = useStableRows(taskRows(shown, leads));
  // Что таблица показывает сейчас (поиск, страница): от этого зависят «все на странице» и выбор. До первого отчёта таблицы — её первая страница.
  const [visible, setVisible] = useState<readonly string[]>(() => rows.slice(0, PAGE_SIZE).map((row) => row.key));
  const bulk = useTaskBulk(shown.flatMap((band) => band.rows), visible, recent, permissions, open, new Date(nowIso));
  const columns = useMemo(() => taskColumns(showAssignee), [showAssignee]);
  const panelHref = (task: QueueTask, move = false) => taskPanelHref(listParams, task, move);
  const onCompleted: TaskTableValue["onCompleted"] = (task, completion) => {
    const band = bands.find((entry) => entry.rows.some((row) => row.key === task.key));
    if (band) completed(task, band, band.rows.findIndex((row) => row.key === task.key), completion);
  };

  return (
    <TaskTableProvider value={{
      nowIso, open, permissions, recent, selection: bulk.any ? bulk.selection : null, selectable: new Set(bulk.selectable.keys()), dial,
      panelHref, navigate: (href) => router.push(href, { scroll: false }), announce, onCompleted, errors, setError,
    }}>
      <div className="grid min-w-0 gap-3" data-testid="task-queue-next">
        <p role="status" aria-live="polite" className="sr-only">{message}</p>
        {dial?.status === "ready" && leads && Object.keys(leads).length > 0 ? <DialListHint /> : null}
        {sheet ? null : <QueueKeys />}
        <DataTable
          label="Задачи"
          data={rows}
          columns={columns}
          getRowId={(row) => row.key}
          onRowClick={(row) => router.push(panelHref(row.task), { scroll: false })}
          getRowLabel={(row) => row.task.title}
          searchPlaceholder="Задача, студент"
          pageSize={PAGE_SIZE}
          onVisibleIdsChange={setVisible}
          partial={partial}
          columnMenu={false}
          empty={<EmptyState title={empty.title} action={empty.action ? <Button variant="outline" asChild><Link href={empty.action.href} scroll={false}>{empty.action.label}</Link></Button> : undefined} />}
          toolbar={<>
            <TaskFilterBar bar={filterBar} />
            {bulk.any ? (
              <Button variant="ghost" data-testid="queue-bulk-pick" onClick={() => (bulk.selection.revealed ? bulk.selection.clear() : bulk.selection.pick())}>
                {bulk.selection.revealed ? "Отмена" : "Выбрать"}
              </Button>
            ) : null}
          </>}
        />
        {bulk.any ? <TaskBulkActions selection={bulk.selection} tasks={bulk.selectable} allKeys={bulk.keys} nowIso={nowIso} skip={bulk.skip} /> : null}
        <UndoToast items={toasts} onHold={hold} />
      </div>
      <TaskSheetHost sheet={sheet} closeHref={closeHref} moveOpen={moveOpen} readOnly={permissions.preview} />
    </TaskTableProvider>
  );
}
