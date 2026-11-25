// Незавершённые записи по программе, которые переживают закрытие приложения (веб: `application-documents-pending.ts`,
// `application-packages-pending.ts`: localStorage и Web Locks). Приложению эти модули веба не подходят (внутри `window`,
// `localStorage`, `navigator.locks`; страж общих импортов их не пропускает), поэтому здесь тот же договор поверх
// AsyncStorage, разборщики и канонический JSON берутся у веба.
//
// Договор, который держит хранилище (он же у веба):
//  1. Запрос записывается ДО сетевого вызова и снимается только после подтверждённой квитанции или точного ответа
//     «не записано» (решает вызывающий). Если приложение убили посреди отправки, запрос остался и его можно повторить
//     с тем же `requestId`, дубля не будет.
//  2. Чужой неизвестный запрос не перезаписывается: другой запрос на ту же цель - конфликт.
//  3. Запись проверяется чтением; не прочиталась так же - ошибка (хранилище нельзя считать надёжным).
//  4. Повреждённая или чужая запись не молчит: цель считается «заблокированной» и экран просит повторить или сообщает, что
//     хранилище не работает; запись не стирается втихую.
//  5. Ключ несёт организацию, участника, дело и программу: на общем телефоне чужие запросы не читаются.
//  6. Один запрос на цель в каждый момент (замок): повторное нажатие во время отправки получает «занято».
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  applicationDocumentCanonical as canonical,
  applicationDocumentExact as exact,
  applicationDocumentRecord as record,
  type ApplicationDocumentScope,
} from "@web/lib/portal/application-documents";
import { universityIntakeId as uuid } from "@web/lib/platform-university-catalog";
import { useEffect, useState } from "react";

/** Организация, участник, дело и программа: весь адрес записей одной программы. */
export type PendingScope = ApplicationDocumentScope;

export type Pending<Intent> = Readonly<{
  intent: Intent | null;
  blocked: boolean;
  /**
   * Запись не удалось прочитать СЕЙЧАС: хранилище не ответило. Повтор позже может помочь, и снимать такую запись нельзя: не
   * ясно, что она вообще нечитаема. Для повреждённой записи (`blocked` без этого признака) повтор не поможет.
   */
  unavailable?: true;
}>;

/** То, что нужно от AsyncStorage; подменяется в тестах. */
export type PendingStorage = Readonly<{
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
  getAllKeys: () => Promise<readonly string[]>;
}>;

export const asyncPendingStorage: PendingStorage = AsyncStorage;

export type PendingKind<Operation extends string, Intent> = Readonly<{
  /** Префикс ключей с версией формата: `evo.application-documents.v1`. */
  name: string;
  operations: readonly Operation[];
  /** Больше этого размера запись считается испорченной. */
  maxLength: number;
  /** Разбор запроса операции: `null`, если он не годится для этой цели и этой программы. */
  parse: (scope: PendingScope, operation: Operation, target: string, value: unknown) => Intent | null;
}>;

export type PendingEntry<Operation extends string, Intent> = Readonly<{ operation: Operation; target: string; intent: Intent | null; blocked: boolean }>;

export type LockResult<T> = Readonly<{ acquired: true; value: T }> | Readonly<{ acquired: false; reason: "busy" | "storage_unavailable" }>;

export type DiscardResult = Readonly<{ ok: true }> | Readonly<{ ok: false; reason: "busy" | "storage_unavailable" }>;

function normalizeScope(scope: PendingScope): PendingScope {
  if (!scope || ![scope.organizationId, scope.membershipId, scope.studentCaseId, scope.applicationId].every(uuid)) throw new Error("Pending scope unavailable");
  return { organizationId: scope.organizationId, membershipId: scope.membershipId, studentCaseId: scope.studentCaseId, applicationId: scope.applicationId };
}

export function createPendingStore<Operation extends string, Intent>(kind: PendingKind<Operation, Intent>) {
  const listeners = new Set<() => void>();
  const held = new Set<string>();

  const prefix = (scope: PendingScope) => {
    const s = normalizeScope(scope);
    return `${kind.name}:${s.organizationId}:${s.membershipId}:${s.studentCaseId}:${s.applicationId}:`;
  };
  function key(scope: PendingScope, operation: Operation, target: string): string {
    if (!kind.operations.includes(operation) || !uuid(target)) throw new Error("Pending operation unavailable");
    return `${prefix(scope)}${operation}:${target}`;
  }
  function decode(raw: string | null, scope: PendingScope, operation: Operation, target: string): Pending<Intent> {
    if (raw === null) return { intent: null, blocked: false };
    try {
      if (raw.length > kind.maxLength) return { intent: null, blocked: true };
      const row = record(JSON.parse(raw));
      if (
        !row ||
        !exact(row, ["protocolVersion", "scope", "operation", "target", "intent"]) ||
        row.protocolVersion !== 1 ||
        canonical(row.scope) !== canonical(normalizeScope(scope)) ||
        row.operation !== operation ||
        row.target !== target
      )
        return { intent: null, blocked: true };
      const intent = kind.parse(scope, operation, target, row.intent);
      return intent ? { intent, blocked: false } : { intent: null, blocked: true };
    } catch {
      return { intent: null, blocked: true };
    }
  }
  function notify(): void {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        // Подписчик экрана не должен ломать запись: сохранённый запрос остаётся главным.
      }
    }
  }

  return {
    kind,
    key,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** Чтение одной цели. Ошибка хранилища или повреждённая запись - `blocked`, не пустота. */
    async read(scope: PendingScope, operation: Operation, target: string, storage: PendingStorage = asyncPendingStorage): Promise<Pending<Intent>> {
      try {
        return decode(await storage.getItem(key(scope, operation, target)), scope, operation, target);
      } catch {
        return { intent: null, blocked: true, unavailable: true };
      }
    },
    /** Только под замком. Чужой неизвестный запрос на ту же цель не перезаписывается. */
    async persist(scope: PendingScope, operation: Operation, target: string, value: Intent, storage: PendingStorage = asyncPendingStorage): Promise<void> {
      const k = key(scope, operation, target);
      const intent = kind.parse(scope, operation, target, value);
      if (!intent) throw new Error("Pending intent invalid");
      const prior = decode(await storage.getItem(k), scope, operation, target);
      if (prior.blocked || (prior.intent && canonical(prior.intent) !== canonical(intent))) throw new Error("Pending conflict");
      const raw = canonical({ protocolVersion: 1, scope: normalizeScope(scope), operation, target, intent });
      if (raw.length > kind.maxLength) throw new Error("Pending too large");
      await storage.setItem(k, raw);
      if ((await storage.getItem(k)) !== raw) throw new Error("Pending persistence unavailable");
      notify();
    },
    /** Снимает только тот же запрос, не тронутый с момента чтения; возвращает, снят ли он. Чужой не трогается. */
    async clear(scope: PendingScope, operation: Operation, target: string, value: Intent, storage: PendingStorage = asyncPendingStorage): Promise<boolean> {
      const k = key(scope, operation, target);
      const intent = kind.parse(scope, operation, target, value);
      if (!intent) return false;
      const raw = await storage.getItem(k);
      const prior = decode(raw, scope, operation, target);
      if (prior.blocked || !prior.intent || canonical(prior.intent) !== canonical(intent) || (await storage.getItem(k)) !== raw) return false;
      await storage.removeItem(k);
      if ((await storage.getItem(k)) !== null) throw new Error("Pending clearing unavailable");
      notify();
      return true;
    },
    /** Все записи программы. Ключи других программ и участников не читаются. */
    async list(scope: PendingScope, storage: PendingStorage = asyncPendingStorage): Promise<readonly PendingEntry<Operation, Intent>[]> {
      try {
        const scoped = prefix(scope);
        const keys = (await storage.getAllKeys()).filter((k) => k.startsWith(scoped));
        const entries: PendingEntry<Operation, Intent>[] = [];
        for (const k of keys) {
          const [operation, target, extra] = k.slice(scoped.length).split(":");
          if (extra !== undefined || !kind.operations.includes(operation as Operation) || !target || !uuid(target)) continue;
          entries.push({ operation: operation as Operation, target, ...decode(await storage.getItem(k), scope, operation as Operation, target) });
        }
        return entries.sort((a, b) => `${a.operation}:${a.target}`.localeCompare(`${b.operation}:${b.target}`));
      } catch {
        throw new Error("Pending inventory unavailable");
      }
    },
    /**
     * Программы владельца, по которым на телефоне есть записи: только по ключам, значения не читаются (чужие записи, даже
     * этого владельца, здесь не открываются). Веб: `listApplicationPackagePendingScopes`.
     */
    async scopes(owner: Readonly<{ organizationId: string; membershipId: string }>, storage: PendingStorage = asyncPendingStorage): Promise<readonly PendingScope[]> {
      try {
        if (!owner || !uuid(owner.organizationId) || !uuid(owner.membershipId)) throw new Error("Invalid owner");
        const ownerPrefix = `${kind.name}:${owner.organizationId}:${owner.membershipId}:`;
        const found = new Map<string, PendingScope>();
        for (const k of await storage.getAllKeys()) {
          if (!k.startsWith(ownerPrefix)) continue;
          const parts = k.slice(ownerPrefix.length).split(":");
          if (parts.length !== 4) continue;
          const [studentCaseId, applicationId, operation, target] = parts as [string, string, string, string];
          if (![studentCaseId, applicationId, target].every(uuid) || !kind.operations.includes(operation as Operation)) continue;
          found.set(`${studentCaseId}:${applicationId}`, { organizationId: owner.organizationId, membershipId: owner.membershipId, studentCaseId, applicationId });
        }
        return [...found.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, scope]) => scope);
      } catch {
        throw new Error("Pending scope inventory unavailable");
      }
    },
    /**
     * Замок цели: один запрос за раз. Занято - `busy`; хранилище не отвечает или команда бросила - `storage_unavailable`
     * (так же у веба: «Web Locks + localStorage»). Замок берётся синхронно, поэтому два нажатия подряд не пройдут оба.
     */
    async withLock<T>(scope: PendingScope, operation: Operation, target: string, fn: () => Promise<T>, storage: PendingStorage = asyncPendingStorage): Promise<LockResult<T>> {
      let k: string;
      try {
        k = key(scope, operation, target);
      } catch {
        return { acquired: false, reason: "storage_unavailable" };
      }
      if (held.has(k)) return { acquired: false, reason: "busy" };
      held.add(k);
      try {
        await storage.getItem(k);
        return { acquired: true, value: await fn() };
      } catch {
        return { acquired: false, reason: "storage_unavailable" };
      } finally {
        held.delete(k);
      }
    },
    /**
     * Отказ от незавершённой записи ОДНОЙ цели (кнопка «Отказаться от незавершённой загрузки»): снимает ровно её ключ; чужие
     * цели, записи других операций и других программ не трогаются. В отличие от `clear` снимает и испорченную запись
     * (`blocked`), которая иначе не уходит. Берёт замок цели, поэтому идущую команду этой цели не прерывает (`busy`);
     * снятие проверяется чтением, подписчики узнают о нём.
     */
    async discard(scope: PendingScope, operation: Operation, target: string, storage: PendingStorage = asyncPendingStorage): Promise<DiscardResult> {
      const locked = await this.withLock(
        scope,
        operation,
        target,
        async () => {
          const k = key(scope, operation, target);
          await storage.removeItem(k);
          if ((await storage.getItem(k)) !== null) throw new Error("Pending discarding unavailable");
          notify();
        },
        storage,
      );
      return locked.acquired ? { ok: true } : { ok: false, reason: locked.reason };
    },
    /** Выход и удаление аккаунта: стираются запросы всех участников этого телефона. */
    async clearAll(storage: PendingStorage = asyncPendingStorage): Promise<void> {
      try {
        const mine = (await storage.getAllKeys()).filter((k) => k.startsWith(`${kind.name}:`));
        for (const k of mine) await storage.removeItem(k);
      } catch {
        // Хранилище недоступно: нечего чистить.
      }
      notify();
    },
  };
}

export type PendingStore<Operation extends string, Intent> = ReturnType<typeof createPendingStore<Operation, Intent>>;

export type PendingView<Intent> = Readonly<{
  intent: Intent | null;
  blocked: boolean;
  /** Запись не удалось прочитать сейчас (см. `Pending.unavailable`): повтор может помочь, снимать её нельзя. */
  unavailable?: true;
  /** Запись прочитана хотя бы раз: до этого форма не принимает нажатий (веб: `useDocumentHydration`). */
  hydrated: boolean;
}>;

/**
 * Незавершённая запись цели как состояние экрана. Перечитывается, когда хранилище сообщило об изменении (запись или
 * снятие в любом месте приложения), поэтому две формы одного документа видят одно и то же. Пока запись этой цели не
 * прочитана (в том числе после смены цели), `hydrated` ложно, а `intent` пуст.
 */
export function usePending<Operation extends string, Intent>(
  store: PendingStore<Operation, Intent>,
  scope: PendingScope,
  operation: Operation,
  target: string,
  storage?: PendingStorage,
): PendingView<Intent> {
  const { organizationId, membershipId, studentCaseId, applicationId } = scope;
  const address = `${organizationId}:${membershipId}:${studentCaseId}:${applicationId}:${operation}:${target}`;
  // Прочитанное помнит, какой цели оно принадлежит: ответ прежней цели новой не достаётся.
  const [read, setRead] = useState<{ address: string; pending: Pending<Intent> } | null>(null);
  useEffect(() => {
    let alive = true;
    let sequence = 0;
    const load = () => {
      const mine = ++sequence;
      void store.read({ organizationId, membershipId, studentCaseId, applicationId }, operation, target, storage).then((pending) => {
        // Поздний ответ прежнего чтения не затирает более свежий, а чтение после ухода экрана никого не трогает.
        if (alive && mine === sequence) setRead({ address, pending });
      });
    };
    load();
    const unsubscribe = store.subscribe(load);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [store, address, organizationId, membershipId, studentCaseId, applicationId, operation, target, storage]);
  return read && read.address === address ? { ...read.pending, hydrated: true } : { intent: null, blocked: false, hydrated: false };
}
