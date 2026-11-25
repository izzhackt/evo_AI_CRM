// «Проверить состояние» и «Открыть список документов» как последовательность без React (порт `update()` из
// `ApplicationRequirementsUI.tsx` веба). Чтение и запись приходят аргументами, поэтому порядок шагов проверяется тестами
// без экрана и без сети.
//
// Правила, которые держит порядок:
//  1. Свежее чтение идёт ПЕРВЫМ: список открывается только если сервер сейчас говорит «не открыт» (`uninitialized`)
//     и дело позволяет (`canInitialize`). Потерянный ответ уже выполненной записи так не повторяется.
//  2. Запрос замораживается один раз и живёт, пока исход не известен: при обрыве (`unavailable`) следующее нажатие
//     шлёт ТОТ ЖЕ запрос с тем же `requestId`. Любой другой исход (успех или точный отказ сервера) запрос снимает.
//  3. После записи всегда идёт контрольное чтение: квитанция не рисуется как текущий список, показывается ответ сервера.
//  4. Неудачное чтение не оставляет прежний ответ «текущим» (решает экран по ошибке запроса).
import type {
  ApplicationRequirementsActionResult,
  ApplicationRequirementsFailure,
  ApplicationRequirementsIntent,
} from "@web/lib/portal/application-requirements";
import type { ApplicationPackageReadiness } from "@web/lib/portal/application-packages";

/** Строка ошибки раздела: ключ словаря `preparations` веба либо своя строка приложения (`prep.forbidden`). */
export type RequirementsErrorKey =
  | "requirementsUnavailable"
  | "unavailable"
  | "prep.forbidden"
  | "configurationHelp"
  | "requestConflict"
  | "initializationIneligible";

export type RequirementsUpdate = Readonly<{
  error: RequirementsErrorKey | null;
  /** Квитанция получена: список документов открыт этим нажатием. */
  initialized: boolean;
}>;

/** Хранилище замороженного запроса на время жизни экрана (веб: `sessionStorage`, на телефоне память экрана). */
export type IntentHolder = Readonly<{
  get: () => ApplicationRequirementsIntent | null;
  set: (intent: ApplicationRequirementsIntent) => void;
  /** Снимает запрос, только если это он: более новый запрос не трогается. */
  clear: (intent: ApplicationRequirementsIntent) => void;
}>;

export type RequirementsUpdateInput = Readonly<{
  /** Нажато «Открыть список документов» (иначе только проверка состояния). */
  initialize: boolean;
  canInitialize: boolean;
  studentCaseId: string;
  applicationId: string;
  /** Свежее чтение; бросает при сбое. Кэш экрана обновляется внутри. */
  read: () => Promise<ApplicationPackageReadiness>;
  runInitialize: (intent: ApplicationRequirementsIntent) => Promise<ApplicationRequirementsActionResult>;
  intents: IntentHolder;
  newRequestId: () => string;
}>;

/** Причина отказа записи -> строка (`ApplicationRequirementsUI.tsx` веба, ветка `!result.ok`). */
export function initializeErrorKey(reason: ApplicationRequirementsFailure): RequirementsErrorKey {
  switch (reason) {
    case "unavailable":
      return "unavailable";
    case "forbidden":
      return "prep.forbidden";
    case "needs_configuration":
      return "configurationHelp";
    case "request_conflict":
      return "requestConflict";
    default:
      return "initializationIneligible";
  }
}

async function tryRead(read: RequirementsUpdateInput["read"]): Promise<ApplicationPackageReadiness | null> {
  try {
    return await read();
  } catch {
    return null;
  }
}

export async function runRequirementsUpdate(input: RequirementsUpdateInput): Promise<RequirementsUpdate> {
  try {
    const latest = await tryRead(input.read);
    if (!latest) return { error: "requirementsUnavailable", initialized: false };
    if (!input.initialize || latest.requirements.state !== "uninitialized" || !input.canInitialize) return { error: null, initialized: false };
    const intent: ApplicationRequirementsIntent = input.intents.get() ?? {
      studentCaseId: input.studentCaseId,
      applicationId: input.applicationId,
      requestId: input.newRequestId(),
    };
    input.intents.set(intent);
    const result = await input.runInitialize(intent);
    // Неизвестный исход (`unavailable`) оставляет запрос для повтора; успех и точный отказ сервера его снимают.
    if (result.ok || result.reason !== "unavailable") input.intents.clear(intent);
    const readback = await tryRead(input.read);
    if (!result.ok) return { error: initializeErrorKey(result.reason), initialized: false };
    return readback ? { error: null, initialized: true } : { error: "requirementsUnavailable", initialized: true };
  } catch {
    // Неожиданный сбой: прежний ответ текущим не остаётся, запрос (если был) остаётся для повтора.
    return { error: "unavailable", initialized: false };
  }
}

/** Держатель запроса в памяти экрана (ссылка React `useRef` подходит как есть: `{ current }`). */
export function memoryIntentHolder(slot: { current: ApplicationRequirementsIntent | null }): IntentHolder {
  return {
    get: () => slot.current,
    set: (intent) => {
      slot.current = intent;
    },
    clear: (intent) => {
      if (slot.current?.requestId === intent.requestId) slot.current = null;
    },
  };
}
