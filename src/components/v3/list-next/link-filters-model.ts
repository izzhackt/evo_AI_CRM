/**
 * Данные меню фильтров-ссылок для списков «Нового вида» («Студенты», «Университеты»). Фильтр, как и раньше, живёт в
 * адресе: пункт меню — ссылка, отбирает сервер. Модель — чистые данные: клиентская панель не получает функций с сервера.
 */
export type LinkFilterOption = Readonly<{ key: string; label: string; href: string; selected: boolean; count?: number | null }>;

export type LinkFilterMenu = Readonly<{
  key: string;
  label: string;
  /** Выбранное значение, если оно не по умолчанию. */
  valueLabel: string | null;
  options: readonly LinkFilterOption[];
}>;

export type LinkFilterBarData = Readonly<{
  menus: readonly LinkFilterMenu[];
  /** «Сбросить»: когда выбран хоть один фильтр или поиск. */
  resetHref: string | null;
}>;

/** Адрес поиска: скрытые поля списка (вид, фильтры) и текст; пустое значение параметра не пишется. */
export function searchHref(action: string, name: string, text: string, hidden: Readonly<Record<string, string | null>>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(hidden)) if (value) params.set(key, value);
  const query = text.trim();
  if (query) params.set(name, query);
  const tail = params.toString();
  return tail ? `${action}?${tail}` : action;
}
