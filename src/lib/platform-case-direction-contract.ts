/**
 * «Задать направление» делу студента: контракт `platform.set_student_case_direction_v1`
 * (миграция 292). Файл клиент-безопасный: без server-only и без Supabase.
 *
 * Значение - одно из пяти направлений сотрудников (`ADMISSIONS_DIRECTIONS`), то
 * есть ровно домен проверки столбца `student_cases.admissions_direction`. Шесть
 * стран продукта (`study-countries.ts`) - страна выбора студента, не направление:
 * Италия и Чехия живут в `EUROPE`.
 */
import { ADMISSIONS_DIRECTIONS, type AdmissionsDirection } from "./platform-admissions-playbook-contract.ts";
import { parseQueueUuid } from "./platform-student-case-queue-contract.ts";

export { parseExpectedAdmissionsVersion, parseQueueUuid } from "./platform-student-case-queue-contract.ts";

/** Что может вернуть команда или действие; «saved» и «unchanged» - успех. */
export type CaseDirectionStatus =
  | "saved"
  | "unchanged"
  | "invalid"
  | "forbidden"
  | "preview"
  | "stale"
  | "playbook_bound"
  | "closed"
  | "access_lost"
  | "request_conflict"
  | "unavailable";

export type CaseDirectionReceipt = Readonly<{
  studentCaseId: string;
  direction: AdmissionsDirection;
  admissionsVersion: string;
  /** false - значение уже стояло, ничего не записано. */
  changed: boolean;
  requestId: string;
  changedAt: string | null;
}>;

export class CaseDirectionContractError extends Error {
  constructor() {
    super("Case direction data is unavailable.");
    this.name = "CaseDirectionContractError";
  }
}

function invalid(): never {
  throw new CaseDirectionContractError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Направление из формы: одно из пяти; всё остальное (в том числе «IT», «CZ») - null. */
export function parseCaseDirection(value: unknown): AdmissionsDirection | null {
  return typeof value === "string" && (ADMISSIONS_DIRECTIONS as readonly string[]).includes(value)
    ? (value as AdmissionsDirection)
    : null;
}

const BIGINT_MAX = "9223372036854775807";

function versionText(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^(?:0|[1-9]\d*)$/.test(value) ||
    value.length > BIGINT_MAX.length ||
    (value.length === BIGINT_MAX.length && value > BIGINT_MAX)
  ) {
    return invalid();
  }
  return value;
}

/**
 * Расписка обязана описывать именно эту запись: та же организация, дело и
 * идентификатор запроса, то же значение, которое просили. Иначе исход
 * неизвестен (запись могла пройти), а не «сохранено».
 */
export function normalizeCaseDirectionReceipt(
  value: unknown,
  expected: Readonly<{ organizationId: string; studentCaseId: string; requestId: string; direction: AdmissionsDirection }>,
): CaseDirectionReceipt {
  if (!isRecord(value)) return invalid();
  const keys = Object.keys(value).sort().join(",");
  if (keys !== "admissions_direction,admissions_version,changed,changed_at,organization_id,request_id,student_case_id") {
    return invalid();
  }
  const direction = parseCaseDirection(value.admissions_direction);
  if (
    direction === null ||
    direction !== expected.direction ||
    parseQueueUuid(value.organization_id) !== expected.organizationId ||
    parseQueueUuid(value.student_case_id) !== expected.studentCaseId ||
    parseQueueUuid(value.request_id) !== expected.requestId ||
    typeof value.changed !== "boolean"
  ) {
    return invalid();
  }
  const changedAt = value.changed_at;
  if (value.changed) {
    if (typeof changedAt !== "string" || !Number.isFinite(Date.parse(changedAt))) return invalid();
  } else if (changedAt !== null) {
    return invalid();
  }
  const admissionsVersion = versionText(value.admissions_version);
  // Записанное дело не бывает на версии 0 (команда поднимает её на единицу).
  if (value.changed && admissionsVersion === "0") return invalid();
  return Object.freeze({
    studentCaseId: expected.studentCaseId,
    direction,
    admissionsVersion,
    changed: value.changed,
    requestId: expected.requestId,
    changedAt: typeof changedAt === "string" ? changedAt : null,
  });
}

/** Ошибка PostgREST команды -> честный исход. Сообщения - контракт миграции 292. */
export function caseDirectionStatusFromRpcError(
  error: unknown,
): Exclude<CaseDirectionStatus, "saved" | "unchanged" | "preview"> {
  if (!isRecord(error)) return "unavailable";
  const code = typeof error.code === "string" ? error.code : null;
  const message = typeof error.message === "string" ? error.message.trim() : null;
  if (code === "42501") return "forbidden";
  if (code === "PT409") return "stale";
  if (code === "22023") {
    if (message === "case_direction_playbook_bound") return "playbook_bound";
    if (message === "case_direction_case_closed") return "closed";
    if (message === "case_direction_actor_access_lost") return "access_lost";
    if (message === "case_direction_request_conflict") return "request_conflict";
    return "invalid";
  }
  return "unavailable";
}
