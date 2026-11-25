// Какие записи «прочитано» не удались: одно хранилище на кабинет, по студенту. Раньше сбой жил в самом хуке `useNotificationRead`,
// то есть у каждого экрана свой: после неудачной записи на ленте и удачной потом на экране ответа куратора лента держала плашку,
// которой уже нечего показывать. Теперь сбой привязан к уведомлению (номер), и удачная запись с ЛЮБОГО экрана его снимает.
// «Отметить все» не удалась - отдельный признак `all` (текст веба markAllReadError: «Часть могла быть отмечена»): он снимается
// удачным «Отметить все» или тем, что непрочитанных не осталось (экран сам не показывает его без непрочитанных).
import { useSyncExternalStore } from "react";

/** Что не получилось: одно уведомление или несколько («Отметить все»). */
export type NotificationReadFailure = "one" | "all";

type Snapshot = Readonly<{ userKey: string; failed: ReadonlySet<string>; all: boolean }>;

const EMPTY: Snapshot = Object.freeze({ userKey: "", failed: new Set<string>(), all: false });
let state: Snapshot = EMPTY;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const emit = () => {
  for (const listener of [...listeners]) listener();
};
const own = (userKey: string): Snapshot => (state.userKey === userKey ? state : { userKey, failed: new Set(), all: false });

/**
 * Итог одной попытки записи. `succeeded` - уведомления, которые записаны (их сбой снимается); `ok` - получилось всё;
 * `failed` - не записанные. Сбой одного уведомления привязывается к его номеру, сбой «Отметить все» ставит общий признак.
 */
export function applyReadOutcome(userKey: string, outcome: Readonly<{ scope: NotificationReadFailure; ok: boolean; succeeded: readonly string[]; failed: readonly string[] }>): void {
  const base = own(userKey);
  const failed = new Set(base.failed);
  for (const id of outcome.succeeded) failed.delete(id);
  let all = base.all;
  if (outcome.ok) {
    if (outcome.scope === "all") all = false;
  } else if (outcome.scope === "all") {
    all = true;
  } else {
    for (const id of outcome.failed) failed.add(id);
  }
  state = { userKey, failed, all };
  emit();
}

/** Сбои записи «прочитано» этого студента; у другого студента на том же устройстве всегда пусто. */
export function useReadFailures(userKey: string): Readonly<{ failed: ReadonlySet<string>; all: boolean }> {
  const snapshot = useSyncExternalStore(subscribe, () => state, () => EMPTY);
  return snapshot.userKey === userKey ? snapshot : EMPTY;
}

/** Для тестов: забыть все сбои. */
export function resetReadFailuresForTests(): void {
  state = EMPTY;
  emit();
}
