import { parseCatalogPreparationIntent, type CatalogPreparationFailure, type CatalogPreparationIntent } from "@/lib/portal/catalog-preparations";
import { parseApplicationRequirementsIntent, type ApplicationRequirementsFailure, type ApplicationRequirementsIntent } from "@/lib/portal/application-requirements";
import { initializeStaffPreparationAction, readStaffPreparationRequirementsAction } from "@/lib/v3/staff-catalog-preparation-actions";

export type StaffPreparationScope = Readonly<{ organizationId: string; membershipId: string; studentCaseId: string }>;
type Intent = CatalogPreparationIntent | ApplicationRequirementsIntent;
const pendingChanged = "evo-staff-preparation-pending";
function subscribe(callback: () => void) {
  window.addEventListener(pendingChanged, callback);
  window.addEventListener("storage", callback);
  return () => { window.removeEventListener(pendingChanged, callback); window.removeEventListener("storage", callback); };
}
export function useStaffPending(scope: StaffPreparationScope, kind: "selection", target?: string): { intent: CatalogPreparationIntent | null; blocked: boolean };
export function useStaffPending(scope: StaffPreparationScope, kind: "requirements", target: string): { intent: ApplicationRequirementsIntent | null; blocked: boolean };
export function useStaffPending(scope: StaffPreparationScope, kind: "selection" | "requirements", target = "case") {
  const raw = useSyncExternalStore(subscribe, () => {
    try { return sessionStorage.getItem(key(scope, kind, target)); } catch { return "unavailable"; }
  }, () => null);
  if (raw === null) return { intent: null, blocked: false };
  try {
    const intent = kind === "selection" ? parseCatalogPreparationIntent(JSON.parse(raw)) : parseApplicationRequirementsIntent(JSON.parse(raw));
    if (!intent || intent.studentCaseId !== scope.studentCaseId || (kind === "requirements" && (!("applicationId" in intent) || intent.applicationId !== target))) return { intent: null, blocked: true };
    return { intent, blocked: false };
  } catch { return { intent: null, blocked: true }; }
}
function key(scope: StaffPreparationScope, kind: "selection" | "requirements", target = "case") {
  return `evo.staff.preparation.v1:${scope.organizationId}:${scope.membershipId}:${scope.studentCaseId}:${kind}:${target}`;
}
export function readStaffPending(scope: StaffPreparationScope, kind: "selection"): CatalogPreparationIntent | null;
export function readStaffPending(scope: StaffPreparationScope, kind: "requirements", target: string): ApplicationRequirementsIntent | null;
export function readStaffPending(scope: StaffPreparationScope, kind: "selection" | "requirements", target = "case"): Intent | null {
  const raw = sessionStorage.getItem(key(scope, kind, target));
  if (!raw) return null;
  const intent = kind === "selection" ? parseCatalogPreparationIntent(JSON.parse(raw)) : parseApplicationRequirementsIntent(JSON.parse(raw));
  if (!intent || intent.studentCaseId !== scope.studentCaseId || (kind === "requirements" && (!("applicationId" in intent) || intent.applicationId !== target))) {
    throw new Error("Saved request unavailable");
  }
  return intent;
}
export function saveStaffPending(scope: StaffPreparationScope, intent: Intent) {
  if (intent.studentCaseId !== scope.studentCaseId) throw new Error("Request case mismatch");
  const value = JSON.stringify(intent);
  const storageKey = "applicationId" in intent ? key(scope, "requirements", intent.applicationId) : key(scope, "selection");
  sessionStorage.setItem(storageKey, value);
  if (sessionStorage.getItem(storageKey) !== value) throw new Error("Request could not be retained");
  window.dispatchEvent(new Event(pendingChanged));
}
export function clearStaffPending(scope: StaffPreparationScope, intent: Intent) {
  const storageKey = "applicationId" in intent ? key(scope, "requirements", intent.applicationId) : key(scope, "selection");
  // A response cannot clear a newer request stored by a different component.
  // Storage becoming unavailable after a confirmed receipt must not erase success.
  try {
    if (sessionStorage.getItem(storageKey) === JSON.stringify(intent)) sessionStorage.removeItem(storageKey);
  } catch { /* The retained request remains safe to replay; readers will show storage failure. */ }
  window.dispatchEvent(new Event(pendingChanged));
}
export const preparationError: Record<CatalogPreparationFailure, string> = {
  invalid: "Не удалось проверить выбор. Обновите сведения и выберите набор снова.",
  forbidden: "Нет доступа к этому действию в текущем деле.",
  request_conflict: "Этот запрос уже относится к другому выбору. Обновите сохранённые подготовки.",
  case_ineligible: "Новая подготовка доступна только для активного дела с открытым порталом.",
  stale_publication: "Карточка обновилась. Откройте актуальные сведения и подтвердите выбор ещё раз.",
  program_unavailable: "Программа больше недоступна в этой публикации. Обновите каталог.",
  intake_unavailable: "Набор больше недоступен в этой публикации. Обновите каталог.",
  intake_identity_required: "Для этого набора ещё нельзя открыть подготовку. Сведения каталога нужно уточнить.",
  unsupported_country: "Подготовка для этой страны пока недоступна. Можно сохранить заявку вручную.",
  intake_closed: "Приём на этот набор закрыт. Выберите другой набор.",
  intake_expired: "Срок выбора этого набора истёк. Выберите другой набор.",
  unavailable: "Ответ не получен. Выбор мог сохраниться. Проверьте подготовки или повторите тот же запрос.",
};
export const requirementsError: Record<ApplicationRequirementsFailure, string> = {
  invalid: "Не удалось проверить запрос подготовки документов.",
  forbidden: "Нет права на подготовку документов в этом деле.",
  request_conflict: "Запрос уже использован. Обновите сохранённую подготовку.",
  case_ineligible: "Добавление стартовых документов недоступно для текущего состояния дела.",
  application_ineligible: "Добавление стартовых документов недоступно для текущего состояния заявки.",
  needs_configuration: "Список документов требует настройки. Существующие документы сохранены.",
  invariant_conflict: "Не удалось подтвердить связи документов. Требуется проверка сотрудником.",
  unavailable: "Ответ не получен. Повторите тот же запрос или перечитайте документы.",
};

/** Called only by a user's click, including the explicit successful-selection chain. */
export async function continueStaffRequirements(scope: StaffPreparationScope, applicationId: string): Promise<string | null> {
  let intent = readStaffPending(scope, "requirements", applicationId);
  const current = await readStaffPreparationRequirementsAction({ studentCaseId: scope.studentCaseId, applicationId });
  if (current.status !== "ready") return current.status === "forbidden"
    ? "Выбор сохранён. Нет доступа к чтению документов этого дела." : "Выбор сохранён. Документы пока не удалось прочитать.";
  if (!intent) {
    if (current.value.state === "needs_configuration") return requirementsError.needs_configuration;
    if (current.value.state !== "uninitialized") return null;
    intent = { studentCaseId: scope.studentCaseId, applicationId, requestId: crypto.randomUUID() };
    saveStaffPending(scope, intent);
  }
  const result = await initializeStaffPreparationAction(scope, intent);
  if (result.ok) {
    clearStaffPending(scope, intent);
    return null;
  }
  if (result.reason !== "unavailable") clearStaffPending(scope, intent);
  return requirementsError[result.reason];
}
import { useSyncExternalStore } from "react";
