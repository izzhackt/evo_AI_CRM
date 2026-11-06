/**
 * «Кураторы стран» (миграция 335, решение владельца 06.11.2026): кто куратор Китая и Малайзии. Форма «Отчёта продаж»
 * подставляет его сама по стране из анкеты лида или из поля «Страна». Здесь — типы, разбор ответов базы и слова формы.
 */
export const COUNTRY_CURATOR_DIRECTIONS = ["CN", "MY"] as const;
export type CountryCuratorDirection = (typeof COUNTRY_CURATOR_DIRECTIONS)[number];
export const isCountryCuratorDirection = (value: unknown): value is CountryCuratorDirection => value === "CN" || value === "MY";
export const COUNTRY_CURATOR_TITLE: Readonly<Record<CountryCuratorDirection, string>> = { CN: "Китай", MY: "Малайзия" };

export type CountryCuratorRow = Readonly<{
  direction: CountryCuratorDirection;
  curatorId: string | null;
  curatorLabel: string | null;
  /** Назначенного куратора ещё можно выбрать (активен, есть права куратора); иначе форма продажи его не подставит. */
  eligible: boolean;
  version: number;
}>;
export type CountryCuratorsData = Readonly<{
  countries: readonly CountryCuratorRow[];
  curators: readonly Readonly<{ id: string; label: string }>[];
}>;
export type CountryCuratorsRead = Readonly<{ status: "available"; data: CountryCuratorsData }> | Readonly<{ status: "denied" | "unavailable" }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
const text = (value: unknown, max: number): value is string => typeof value === "string" && [...value].length <= max
  && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
const version = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** Ответ `country_curators_v1`: ровно две страны в порядке CN, MY; иначе null (страница скажет «не удалось прочитать»). */
export function parseCountryCurators(data: unknown, organizationId: string): CountryCuratorsData | null {
  if (!isRecord(data) || !exactKeys(data, ["schemaVersion", "organizationId", "countries", "curators"])
    || data.schemaVersion !== 1 || data.organizationId !== organizationId
    || !Array.isArray(data.countries) || data.countries.length !== 2 || !Array.isArray(data.curators) || data.curators.length > 1000) return null;
  const countries: CountryCuratorRow[] = [];
  for (const [index, raw] of data.countries.entries()) {
    if (!isRecord(raw) || !exactKeys(raw, ["direction", "curatorId", "curatorLabel", "eligible", "version"])
      || raw.direction !== COUNTRY_CURATOR_DIRECTIONS[index]
      || !(raw.curatorId === null || (typeof raw.curatorId === "string" && UUID.test(raw.curatorId)))
      || !(raw.curatorLabel === null || text(raw.curatorLabel, 300))
      || typeof raw.eligible !== "boolean" || !version(raw.version)) return null;
    countries.push({ direction: COUNTRY_CURATOR_DIRECTIONS[index], curatorId: raw.curatorId === null ? null : raw.curatorId.toLowerCase(),
      curatorLabel: raw.curatorLabel, eligible: raw.eligible, version: raw.version });
  }
  const curators: { id: string; label: string }[] = [];
  for (const raw of data.curators) {
    if (!isRecord(raw) || !exactKeys(raw, ["id", "label"]) || typeof raw.id !== "string" || !UUID.test(raw.id) || !text(raw.label, 300)) return null;
    curators.push({ id: raw.id.toLowerCase(), label: raw.label });
  }
  return { countries, curators };
}

export type CountryCuratorSaveResult =
  | Readonly<{ status: "saved" | "unchanged" }>
  | Readonly<{ status: "forbidden" | "invalid" | "version_conflict" | "request_conflict" | "unavailable" }>;

/** Ответ `country_curator_save_v1`: статус и версия той страны, которую сохраняли. */
export function parseCountryCuratorSaved(data: unknown, organizationId: string, direction: CountryCuratorDirection): "saved" | "unchanged" | null {
  if (!isRecord(data) || data.organizationId !== organizationId || data.direction !== direction || !version(data.version)) return null;
  return data.status === "saved" || data.status === "unchanged" ? data.status : null;
}

export type CountryCuratorFormState = Readonly<{
  status: "idle" | "saved" | "unchanged" | "forbidden" | "invalid" | "version_conflict" | "request_conflict" | "unavailable";
  requestId: string;
}>;

export const COUNTRY_CURATOR_FORM_MESSAGE: Readonly<Record<CountryCuratorFormState["status"], string>> = {
  idle: "",
  saved: "Сохранено.",
  unchanged: "Без изменений.",
  forbidden: "Менять кураторов стран может только администратор.",
  invalid: "Этого сотрудника нельзя выбрать куратором. Обновите страницу.",
  version_conflict: "Настройку уже изменили. Обновите страницу.",
  request_conflict: "Этот запрос уже отправлен с другим выбором. Обновите страницу.",
  unavailable: "Не удалось сохранить. Попробуйте ещё раз.",
};
