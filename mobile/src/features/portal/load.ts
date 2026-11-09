import type { MobileStringKey } from "@/i18n";
import { loadErrorKey, sourceState } from "@/api/queries";

export type Load = { state: "loading" } | { state: "error"; message: string; onRetry: () => void };

type QueryLike = Readonly<{ data: unknown; isPending: boolean; isError: boolean; fetchStatus: string; status: string; error: unknown; refetch: () => unknown }>;

/**
 * Состояние источника для карточки: `null`, когда данные есть (в том числе из кэша
 * после неудачного обновления). Текст ошибки только из словаря приложения.
 */
export function loadOf(query: QueryLike, m: (key: MobileStringKey) => string): Load | null {
  const state = sourceState(query);
  if (state === "ready") return null;
  if (state === "loading") return { state: "loading" };
  return { state: "error", message: m(loadErrorKey(query.error)), onRetry: () => void query.refetch() };
}
