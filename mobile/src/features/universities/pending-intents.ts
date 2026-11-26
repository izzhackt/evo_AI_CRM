// Неотправленные до конца действия выбора программы: запрос хранится, пока исход не известен (веб: student-preparation-pending.ts,
// там sessionStorage). Приложение кладёт их в AsyncStorage: запрос переживает и закрытие экрана, и перезапуск, и повтор после обрыва
// шлёт тот же `p_request_id` (инвариант 2 слоя RPC). Подтверждённый исход (успех или окончательный отказ) запись удаляет. Ключ несёт
// студента и дело, поэтому на общем телефоне чужие запросы не читаются; при выходе записи стираются (`clearUniversityCaches`).
import AsyncStorage from "@react-native-async-storage/async-storage";

import { parseApplicationRequirementsIntent, type ApplicationRequirementsIntent } from "@web/lib/portal/application-requirements";
import { parseCatalogPreparationIntent, type CatalogPreparationIntent } from "@web/lib/portal/catalog-preparations";

/** Общий префикс ключей: при выходе удаляются все ключи с ним (`clearPendingIntents`). */
export const PENDING_INTENT_PREFIX = "evo.portal.preparation-intent.v1";

export type PendingScope = Readonly<{ userKey: string; studentCaseId: string }>;
export type PendingIntent = CatalogPreparationIntent | ApplicationRequirementsIntent;

/** Выбор набора определяют вуз, программа и набор; версия публикации личность выбора не меняет (веб: `selectionTarget`). */
export function selectionTarget(intent: Pick<CatalogPreparationIntent, "institutionId" | "programId" | "intakeId">): string {
  return [intent.institutionId, intent.programId, intent.intakeId].join(":");
}

const isSelection = (intent: PendingIntent): intent is CatalogPreparationIntent => "institutionId" in intent;

function keyOf(scope: PendingScope, kind: "selection" | "requirements", target: string): string {
  return [PENDING_INTENT_PREFIX, scope.userKey, scope.studentCaseId, kind, target].join(":");
}

export type IntentStore = Readonly<{
  readSelection(target: string): Promise<CatalogPreparationIntent | null>;
  readRequirements(applicationId: string): Promise<ApplicationRequirementsIntent | null>;
  persist(intent: PendingIntent): Promise<void>;
  /** Удаляет запись, только если в ней тот же запрос: чужой, более новый запрос не трогается (веб: `clearPreparationIntent`). */
  clear(intent: PendingIntent): Promise<void>;
}>;

async function read<T extends PendingIntent>(key: string, parse: (value: unknown) => T | null, accept: (intent: T) => boolean): Promise<T | null> {
  let raw: string | null;
  try {
    raw = await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
  if (raw === null) return null;
  let intent: T | null = null;
  try {
    intent = parse(JSON.parse(raw));
  } catch {
    intent = null;
  }
  if (intent !== null && accept(intent)) return intent;
  // Испорченная или чужая запись не годится: удаляется, чтобы не мешать новому выбору.
  await AsyncStorage.removeItem(key).catch(() => undefined);
  return null;
}

export function intentStore(scope: PendingScope): IntentStore {
  return {
    readSelection: (target) =>
      read(keyOf(scope, "selection", target), parseCatalogPreparationIntent, (intent) => intent.studentCaseId === scope.studentCaseId && selectionTarget(intent) === target),
    readRequirements: (applicationId) =>
      read(keyOf(scope, "requirements", applicationId), parseApplicationRequirementsIntent, (intent) => intent.studentCaseId === scope.studentCaseId && intent.applicationId === applicationId),
    async persist(intent) {
      if (intent.studentCaseId !== scope.studentCaseId) throw new Error("Pending intent of another case");
      const selection = isSelection(intent);
      const parsed = selection ? parseCatalogPreparationIntent(intent) : parseApplicationRequirementsIntent(intent);
      if (parsed === null) throw new Error("Invalid pending intent");
      await AsyncStorage.setItem(keyOf(scope, selection ? "selection" : "requirements", selection ? selectionTarget(intent) : intent.applicationId), JSON.stringify(parsed));
    },
    async clear(intent) {
      const selection = isSelection(intent);
      const key = keyOf(scope, selection ? "selection" : "requirements", selection ? selectionTarget(intent) : intent.applicationId);
      try {
        const raw = await AsyncStorage.getItem(key);
        if (raw !== null && (JSON.parse(raw) as { requestId?: unknown }).requestId === intent.requestId) await AsyncStorage.removeItem(key);
      } catch {
        // нечего удалять или хранилище недоступно: исход уже известен, запись только мешает
      }
    },
  };
}

/** Выход из аккаунта и удаление аккаунта: записи всех студентов на этом устройстве стираются. */
export async function clearPendingIntents(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const mine = keys.filter((key) => key.startsWith(`${PENDING_INTENT_PREFIX}:`));
    if (mine.length > 0) await AsyncStorage.multiRemove(mine);
  } catch {
    // хранилище недоступно: нечего чистить
  }
}
