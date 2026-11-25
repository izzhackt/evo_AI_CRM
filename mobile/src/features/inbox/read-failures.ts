// Какие записи «прочитано» не удались: одно хранилище на открытый КАБИНЕТ (его кэш чтений - `QueryClient`, который создаётся заново
// при каждом входе), по студенту и по номеру уведомления. Раньше сбой жил в самом хуке `useNotificationRead`, то есть у каждого экрана
// свой: после неудачной записи на ленте и удачной потом на экране ответа куратора лента держала плашку, которой уже нечего показывать.
// Теперь сбой привязан к уведомлению, и удачная запись с ЛЮБОГО экрана его снимает. Выход из кабинета и вход заново (в том числе того же
// студента) начинают с чистого листа: у нового входа новый кэш, а значит и новое хранилище; чужой студент на том же устройстве
// чужих сбоев не видит.
// «Отметить все» не удалась (текст веба markAllReadError: «Часть могла быть отмечена»): запоминаются НОМЕРА, которые остались
// неотмеченными, а не общий признак. Плашка стоит, пока непрочитано хотя бы одно из них; отметили поодиночке или прочитали на сайте -
// плашка уходит, и новое непрочитанное уведомление, пришедшее позже, её не воскрешает. Удачный «Отметить все» снимает всё.
import type { QueryClient } from "@tanstack/react-query";
import { useCallback, useSyncExternalStore } from "react";

/** Что не получилось: одно уведомление или несколько («Отметить все»). */
export type NotificationReadFailure = "one" | "all";

type Snapshot = Readonly<{ userKey: string; failed: ReadonlySet<string>; allFailed: ReadonlySet<string> }>;
type Store = { snapshot: Snapshot; listeners: Set<() => void> };

const EMPTY: Snapshot = Object.freeze({ userKey: "", failed: new Set<string>(), allFailed: new Set<string>() });
const stores = new WeakMap<QueryClient, Store>();

function storeOf(session: QueryClient): Store {
  let store = stores.get(session);
  if (!store) {
    store = { snapshot: EMPTY, listeners: new Set() };
    stores.set(session, store);
  }
  return store;
}

/**
 * Итог одной попытки записи в кабинете `session`. `succeeded` - уведомления, которые записаны (их сбои снимаются); `ok` - получилось
 * всё; `failed` - не записанные. Сбой одного уведомления привязывается к его номеру; сбой «Отметить все» запоминает номера, которые
 * остались неотмеченными.
 */
export function applyReadOutcome(
  session: QueryClient,
  userKey: string,
  outcome: Readonly<{ scope: NotificationReadFailure; ok: boolean; succeeded: readonly string[]; failed: readonly string[] }>,
): void {
  const store = storeOf(session);
  const base = store.snapshot.userKey === userKey ? store.snapshot : { ...EMPTY, userKey };
  const failed = new Set(base.failed);
  let allFailed = new Set(base.allFailed);
  for (const id of outcome.succeeded) {
    failed.delete(id);
    allFailed.delete(id);
  }
  if (outcome.ok) {
    if (outcome.scope === "all") allFailed = new Set();
  } else if (outcome.scope === "all") {
    allFailed = new Set(outcome.failed);
  } else {
    for (const id of outcome.failed) failed.add(id);
  }
  store.snapshot = { userKey, failed, allFailed };
  for (const listener of [...store.listeners]) listener();
}

/** Сбои записи «прочитано» этого студента в этом кабинете; у другого студента и в новом кабинете всегда пусто. */
export function useReadFailures(session: QueryClient, userKey: string): Readonly<{ failed: ReadonlySet<string>; allFailed: ReadonlySet<string> }> {
  const store = storeOf(session);
  const subscribe = useCallback(
    (listener: () => void) => {
      store.listeners.add(listener);
      return () => {
        store.listeners.delete(listener);
      };
    },
    [store],
  );
  const snapshot = useSyncExternalStore(subscribe, () => store.snapshot, () => EMPTY);
  return snapshot.userKey === userKey ? snapshot : EMPTY;
}
