/**
 * Состояние очереди живёт в адресе: вид, фильтры, поиск и открытая запись.
 * Back, обновление и пересланная ссылка возвращают тот же экран.
 */
export type QueueParams = Readonly<Record<string, string | null | undefined>>;

/**
 * `path?key=value…` без пустых значений: `null`, `undefined` и "" в
 * `overrides` убирают параметр. Порядок ключей — порядок `params`, затем
 * новых ключей `overrides`, поэтому адреса одного экрана не расходятся.
 */
export function queueHref(path: string, params: QueueParams, overrides: QueueParams = {}): string {
  const merged: Record<string, string | null | undefined> = { ...params };
  for (const [key, value] of Object.entries(overrides)) merged[key] = value;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) {
    if (value !== null && value !== undefined && value !== "") query.set(key, value);
  }
  const text = query.toString();
  return text ? `${path}?${text}` : path;
}

/** Выбранные значения фильтров, кроме значений по умолчанию: число для «Фильтры (n)». */
export function activeFilterCount(values: readonly (string | null | undefined)[]): number {
  return values.filter((value) => value !== null && value !== undefined && value !== "").length;
}
