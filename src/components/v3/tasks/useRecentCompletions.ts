"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { mutateStaffTaskAction } from "@/lib/platform-staff-task-actions";

import { queueFocusAfterRemoval } from "../queue/queue-navigation";
import { STAFF_ERROR_COPY, staffStatusForm } from "./task-commands";
import type { RecentCompletion } from "./TaskQueueRow";

/** Сколько строка держит «Завершено · Отменить» до обновления списка. */
export const TASK_UNDO_MS = 6000;

/** Группа очереди с завершаемыми строками: у «Задач» строка — задача, у «Сегодня» — строка очереди. */
export type CompletionBand<Row extends Readonly<{ key: string }>> = Readonly<{
  key: string;
  label: string;
  count: number | null;
  danger: boolean;
  rows: readonly Row[];
}>;

/** `expiresAt` — свой срок «Отменить» у каждой строки (мс, `Date.now()`). */
export type RecentEntry<Row> = Readonly<RecentCompletion & { row: Row; band: string; index: number; label: string; danger: boolean; expiresAt: number }>;

/**
 * Фокус на «Отменить», срок которого вышел (`expiring`), переходит на соседнюю
 * остающуюся строку — не на страницу: кнопка исчезает сейчас, строка — с
 * обновлением списка. `gone` — все строки, которые уйдут с обновлением.
 * «Отменить» нового облика стоит не в строке, а в верхнем слое (UndoToast):
 * её строку называет `data-undo-row`.
 */
function keepFocusInList(gone: ReadonlySet<string>, expiring: ReadonlySet<string>) {
  const active = document.activeElement;
  const undo = active instanceof HTMLElement && active.matches("[data-queue-undo]") ? active : null;
  const rows = [...document.querySelectorAll<HTMLElement>("[data-queue-row]")];
  const row = undo?.closest<HTMLElement>("[data-queue-row]") ?? rows.find((element) => element.dataset.queueRow === undo?.dataset.undoRow) ?? null;
  const current = row?.dataset.queueRow;
  if (!row || !current || !expiring.has(current)) return;
  const target = queueFocusAfterRemoval(rows.map((element) => element.dataset.queueRow ?? ""), current, gone);
  // Остающихся строк нет — фокус остаётся в своей строке, на её названии.
  (rows.find((element) => element.dataset.queueRow === target) ?? row).querySelector<HTMLElement>("[data-queue-open]")?.focus();
}

function withoutKey<Row>(recent: Readonly<Record<string, RecentEntry<Row>>>, key: string) {
  return Object.fromEntries(Object.entries(recent).filter(([entry]) => entry !== key));
}

/**
 * Завершение на месте (круг строки задачи) с «Отменить» — общее для «Задач»
 * и «Сегодня». Недавно завершённая рабочая задача остаётся на своём месте
 * около 6 секунд с «Отменить» — даже если список за это время обновился — и
 * только потом исчезает вместе с обновлением. Ключ строки — ключ задачи
 * (`staff:<id>`): по нему и `data-queue-row` работает возврат фокуса.
 */
export function useRecentCompletions<Row extends Readonly<{ key: string }>>(bands: readonly CompletionBand<Row>[]) {
  const router = useRouter();
  const [recent, setRecent] = useState<Readonly<Record<string, RecentEntry<Row>>>>({});
  const [message, setMessage] = useState("");
  const [seenBands, setSeenBands] = useState(bands);

  // Истёкшая отмена держит строку «завершённой», пока обновлённый список
  // сервера её не уберёт: без мигания обратно в открытую задачу.
  if (seenBands !== bands) {
    setSeenBands(bands);
    const serverKeys = new Set(bands.flatMap((band) => band.rows.map((row) => row.key)));
    setRecent((current) => Object.fromEntries(Object.entries(current).filter(([key, entry]) => !entry.expired || serverKeys.has(key))));
  }

  // У каждой отмены свой срок: обновление списка и завершение другой задачи
  // его не продлевают. Таймер ждёт ближайший срок.
  useEffect(() => {
    const live = Object.values(recent).filter((entry) => !entry.expired);
    if (!live.length) return;
    const timer = window.setTimeout(() => {
      const now = Date.now();
      // Уйдут все недавно завершённые строки — и те, чьё «Отменить» ещё идёт.
      keepFocusInList(new Set(Object.keys(recent)), new Set(live.filter((entry) => entry.expiresAt <= now).map((entry) => entry.task.key)));
      setRecent((current) => Object.fromEntries(Object.entries(current).map(([key, entry]) =>
        [key, entry.expired || entry.expiresAt > now ? entry : { ...entry, expired: true }])));
      router.refresh();
    }, Math.max(0, Math.min(...live.map((entry) => entry.expiresAt)) - Date.now()));
    return () => window.clearTimeout(timer);
  }, [recent, router]);

  const announce = useCallback((text: string) => setMessage(text), []);

  const undo = useCallback(async (completion: RecentCompletion): Promise<string | null> => {
    try {
      const state = await mutateStaffTaskAction(
        { status: "idle", requestId: crypto.randomUUID(), taskId: null, version: null },
        staffStatusForm({ id: completion.task.id, version: completion.version }, completion.previousStatus),
      );
      if (state.status !== "saved") return STAFF_ERROR_COPY[state.status] ?? "Не удалось отменить. Обновите страницу.";
      setRecent((current) => withoutKey(current, completion.task.key));
      setMessage(`Завершение задачи «${completion.task.title}» отменено.`);
      router.refresh();
      return null;
    } catch {
      return "Не удалось отменить. Обновите страницу.";
    }
  }, [router]);

  const completed = useCallback((row: Row, band: CompletionBand<Row>, index: number, completion: RecentCompletion) => {
    const expiresAt = Date.now() + TASK_UNDO_MS;
    setRecent((current) => ({
      ...current,
      [row.key]: { ...completion, row, band: band.key, index, label: band.label, danger: band.danger, expired: false, expiresAt },
    }));
  }, []);

  // Строка, завершённая за последние секунды, стоит на прежнем месте, даже
  // если обновлённый список сервера её уже не содержит.
  const shown: CompletionBand<Row>[] = bands.map((band) => {
    const rows = [...band.rows];
    for (const entry of Object.values(recent)) {
      if (!entry.expired && entry.band === band.key && !rows.some((row) => row.key === entry.row.key)) {
        rows.splice(Math.min(entry.index, rows.length), 0, entry.row);
      }
    }
    return { ...band, rows };
  });
  for (const entry of Object.values(recent)) {
    if (!entry.expired && !shown.some((band) => band.key === entry.band)) {
      shown.push({ key: entry.band, label: entry.label, count: null, danger: entry.danger, rows: [entry.row] });
    }
  }

  return { recent, message, announce, undo, completed, shown };
}
