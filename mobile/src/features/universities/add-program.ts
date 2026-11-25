// «Добавить в мои программы»: порядок действий и тексты отказов, как у веба (SelectionAction.tsx,
// student-preparation-ui-actions.ts). Чистая оркестровка без React Native: транспорт, хранилище запросов и новый id приходят
// аргументами, поэтому порядок проверяется тестами без экрана.
//
// Порядок: 1) запрос выбора берётся из хранилища или создаётся и сохраняется (повтор шлёт тот же `p_request_id`); 2) перед отправкой
// читается список программ: потерянный ответ мог уже сохранить выбор; 3) выбор; 4) запрос удаляется, как только исход известен;
// 5) отдельной операцией открывается список документов программы (сбой тут никогда не повторяет выбор и не прячет сохранённую программу).
import { parseApplicationDocuments } from "@web/lib/portal/application-documents";
import { parseApplicationRequirementsReceipt, type ApplicationRequirementsIntent } from "@web/lib/portal/application-requirements";
import type { CatalogPreparationFailure, CatalogPreparationIntent } from "@web/lib/portal/catalog-preparations";
import type { PortalStrings } from "@web/lib/portal/i18n";

import { readPreparations } from "@/api/portal-reads";
import { createWrite, RpcError, rpcRead, rpcWrite, type RpcTransport } from "@/lib/rpc";

import { selectProgram, selectProgramWrite } from "./api";
import { selectionTarget, type IntentStore } from "./pending-intents";

/** Что выбирается: вуз, программа, набор и версия карточки, по которой студент смотрел (дело добавляется оркестровкой). */
export type AddTarget = Omit<CatalogPreparationIntent, "requestId" | "studentCaseId">;

export type AddDeps = Readonly<{
  transport: RpcTransport;
  store: IntentStore;
  newId: () => string;
  studentCaseId: string;
  /** Дело активно и кабинет открыт (`canSelectPrograms`): только тогда список документов открывается сам (веб: `canInitialize`). */
  canSelect: boolean;
}>;

export type AddOutcome =
  | Readonly<{ ok: true; applicationId: string }>
  | Readonly<{
      ok: false;
      reason: CatalogPreparationFailure;
      /** `true`: исход неизвестен, запрос сохранён, повтор пойдёт с тем же id («Проверить сохранение и продолжить»). */
      uncertain: boolean;
    }>;

/**
 * Причина отказа по ошибке: имя из закрытого списка (`RpcError.catalog`), `forbidden` по 42501, всё остальное (обрыв, 5xx, неверный
 * ответ, чтение списка не удалось) - `unavailable`: исход неизвестен, запрос остаётся.
 */
export function selectionFailure(error: unknown): CatalogPreparationFailure {
  if (error instanceof RpcError) {
    if (error.catalog !== null) return error.catalog;
    if (error.kind === "forbidden") return "forbidden";
  }
  return "unavailable";
}

/** Текст отказа (веб: `selectionError` в SelectionAction.tsx). */
export function selectionMessage(reason: CatalogPreparationFailure, strings: PortalStrings<"preparations">): string {
  switch (reason) {
    case "unavailable":
      return strings.unavailable;
    case "stale_publication":
      return strings.stalePublication;
    case "forbidden":
      return strings.forbidden;
    case "case_ineligible":
      return strings.caseIneligible;
    case "request_conflict":
      return strings.requestConflict;
    case "unsupported_country":
      return strings.unsupportedCountry;
    case "intake_identity_required":
      return strings.identityMissing;
    case "intake_closed":
    case "intake_expired":
      return strings.closedIntake;
    default:
      return strings.choiceUnavailable;
  }
}

/**
 * Выбор программы. Неопределённый исход (`uncertain`) оставляет запрос в хранилище, окончательный отказ удаляет его.
 * Сбой хранилища выбор не останавливает: повтор внутри открытого экрана держит тот же запрос в памяти (хук), а потеря записи
 * после перезапуска безопасна, потому что список читается перед отправкой, а сервер на новый запрос по тому же набору отдаёт
 * прежнюю связь.
 */
export async function addProgram(deps: AddDeps, target: AddTarget): Promise<AddOutcome> {
  const identity = { institutionId: target.institutionId, programId: target.programId, intakeId: target.intakeId };
  const targetKey = selectionTarget(identity);
  const stored = await deps.store.readSelection(targetKey).catch(() => null);
  const intent: CatalogPreparationIntent = stored ?? { ...target, studentCaseId: deps.studentCaseId, requestId: deps.newId() };
  if (stored === null) await deps.store.persist(intent).catch(() => undefined);

  let applicationId: string;
  try {
    // Список читается до отправки: потерянный ответ мог уже сохранить этот выбор, тогда второй раз он не отправляется.
    const current = await readPreparations(deps.transport, deps.studentCaseId);
    const saved = current.find((item) => item.institutionId === intent.institutionId && item.programId === intent.programId && item.intakeId === intent.intakeId);
    if (saved) {
      applicationId = saved.applicationId;
    } else {
      const { requestId, studentCaseId, ...rest } = intent;
      const receipt = await selectProgram(deps.transport, selectProgramWrite({ ...rest, studentCaseId }, requestId), { ...rest, studentCaseId });
      applicationId = receipt.applicationId;
    }
  } catch (error) {
    const reason = selectionFailure(error);
    const uncertain = reason === "unavailable";
    if (!uncertain) await deps.store.clear(intent);
    return { ok: false, reason, uncertain };
  }
  await deps.store.clear(intent);
  await openRequirements(deps, applicationId);
  return { ok: true, applicationId };
}

/**
 * Список документов программы открывается сам, если он ещё не открыт и это разрешено делу (веб: `canInitialize`: дело активно,
 * кабинет открыт, заявка в подготовке). Сбой ничего не отменяет: студент придёт на экран программы и откроет список кнопкой.
 * Неопределённый сбой оставляет запрос в хранилище (ключ `...:requirements:<applicationId>`): его подхватит только повтор этого
 * же действия с этого экрана, с тем же id. Экран программы (#1556) держит свой запрос открытия в памяти и этого ключа не читает:
 * пути ключа не делят. Это безопасно на сервере (миграция 218): тот же id отдаёт прежнюю квитанцию, новый id по уже открытому
 * списку документов - прежнюю квитанцию и одну запись аудита; ничего не задваивается.
 */
export async function openRequirements(deps: AddDeps, applicationId: string): Promise<void> {
  try {
    const items = await readPreparations(deps.transport, deps.studentCaseId);
    const saved = items.find((item) => item.applicationId === applicationId);
    if (!saved || !deps.canSelect || saved.applicationStatus !== "preparation") return;
    const documents = parseApplicationDocuments(
      await rpcRead(deps.transport, "student_application_documents_v1", { p_student_case_id: deps.studentCaseId, p_application_id: applicationId }),
      { studentCaseId: deps.studentCaseId, applicationId },
    );
    if (documents === null || documents.requirements.state !== "uninitialized") return;
    const stored = await deps.store.readRequirements(applicationId).catch(() => null);
    const intent: ApplicationRequirementsIntent = stored ?? { studentCaseId: deps.studentCaseId, applicationId, requestId: deps.newId() };
    if (stored === null) await deps.store.persist(intent).catch(() => undefined);
    try {
      const write = createWrite("student_initialize_application_requirements_v1", { p_student_case_id: deps.studentCaseId, p_application_id: applicationId }, { requestId: intent.requestId });
      const receipt = parseApplicationRequirementsReceipt(await rpcWrite(deps.transport, write), intent);
      if (receipt !== null) await deps.store.clear(intent);
    } catch (error) {
      // Окончательный отказ сервера (не обрыв и не 5xx) запрос закрывает; неопределённый оставляет для повтора с тем же id.
      if (error instanceof RpcError && (error.kind === "forbidden" || error.kind === "conflict" || error.kind === "invalid")) await deps.store.clear(intent);
    }
  } catch {
    // чтение не удалось: список документов откроется на экране программы
  }
}
