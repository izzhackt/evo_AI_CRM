import { useEffect } from "react";

/**
 * Сообщает странице, какие строки сейчас на экране (после поиска и страницы), когда набор изменился.
 * `report` должна быть устойчивой функцией (`useCallback` или функция модуля), иначе вызов повторяется на каждый вид.
 */
export function useReportVisibleIds(rowIds: readonly string[], report?: (ids: readonly string[]) => void): void {
  const key = rowIds.join("\u001f");
  useEffect(() => {
    report?.(key === "" ? [] : key.split("\u001f"));
  }, [key, report]);
}
