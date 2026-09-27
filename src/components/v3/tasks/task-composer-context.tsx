"use client";

import { useEffect, useSyncExternalStore } from "react";

import type { CalendarCaseOption, Day } from "../calendar/types";

/**
 * Контекст страницы для единственного диалога «Новая задача» (Э7): что
 * заполнить заранее, когда диалог открывают «Создать задачу» оболочки или
 * Ctrl+K. Дело студента и «Быстрый просмотр» — дело; Lead 360 — лид (или
 * дело лида); «Календарь» — выбранный день. Это только подсказка формы:
 * права и вид задачи проверяют команды создания.
 */
export type TaskComposerPageContext = Readonly<{
  case?: CalendarCaseOption | null;
  /** Исполнители дела, уже прочитанные страницей; иначе диалог прочитает их сам. */
  caseAssignees?: readonly Readonly<{ membershipId: string; displayName: string }>[];
  /** Рабочая задача по лиду: версия процесса лида нужна команде создания. */
  lead?: Readonly<{ id: string; version: string; name: string | null }> | null;
  /** День срока по умолчанию («Календарь»); без него — сегодня. */
  dueDay?: Day | null;
  /**
   * Дело выбрано самим входом («+ Задача» «Быстрого просмотра»), а не взято
   * из страницы для «Создать задачу» меню: его в диалоге не убирают.
   */
  caseFixed?: boolean;
}>;

type Entry = Readonly<{ token: symbol; value: TaskComposerPageContext }>;

let entries: readonly Entry[] = [];
let current: TaskComposerPageContext | null = null;
const listeners = new Set<() => void>();

function publish(next: readonly Entry[]) {
  entries = next;
  current = next.at(-1)?.value ?? null;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Последняя отмеченная страницей часть — самая узкая (панель поверх списка). */
export function useTaskComposerPageContext(): TaskComposerPageContext | null {
  return useSyncExternalStore(subscribe, () => current, () => null);
}

/** Отметка страницы: пока она смонтирована, диалог оболочки знает её контекст. */
export function TaskComposerContextMark({ value }: Readonly<{ value: TaskComposerPageContext }>) {
  const key = JSON.stringify(value);
  useEffect(() => {
    const token = Symbol("task-composer-context");
    publish([...entries, { token, value: JSON.parse(key) as TaskComposerPageContext }]);
    return () => publish(entries.filter((entry) => entry.token !== token));
  }, [key]);
  return null;
}

type Opener = (context?: TaskComposerPageContext, returnFocus?: HTMLElement | null) => void;
let opener: Opener | null = null;

/** Диалог оболочки (`TaskComposerHost`) один: регистрирует себя здесь. */
export function registerTaskComposerOpener(next: Opener): () => void {
  opener = next;
  return () => { if (opener === next) opener = null; };
}

/**
 * Открыть единственный диалог создания задачи на месте. false — диалога
 * оболочки нет (статическая страница, нет прав): вызывающий идёт прежней
 * ссылкой `/v3/tasks?create=staff`. `returnFocus` — куда вернуть фокус, если
 * кнопка, открывшая диалог, к его закрытию будет скрыта (лист «Ещё» телефона).
 */
export function openTaskComposer(context?: TaskComposerPageContext, returnFocus?: HTMLElement | null): boolean {
  if (!opener) return false;
  opener(context, returnFocus);
  return true;
}
