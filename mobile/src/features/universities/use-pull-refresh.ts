// Полоса «потянули вниз» экрана (`RefreshControl`): горит только у запроса, который начал сам студент. Автоматическое перечитывание
// (возврат в приложение, перепроверка версии каталога, перечитывание после записи - сердечко, «Добавить в мои программы») идёт молча:
// иначе полоса появлялась бы сама, а на iPhone ещё и сдвигала бы содержимое вниз. Один хук на экраны каталога: у каждого экрана
// нет своей копии, и `isRefetching` запроса в полосу не подставляется.
import { useCallback, useState } from "react";

/**
 * @param refetch перечитывание запроса экрана (`query.refetch`); его результат возвращает `pull`.
 * @returns `refreshing` - для `Screen`, `pull` - для его `onRefresh`.
 */
export function usePullRefresh<T>(refetch: () => Promise<T>): { refreshing: boolean; pull: () => Promise<T> } {
  const [refreshing, setRefreshing] = useState(false);
  const pull = useCallback(async () => {
    setRefreshing(true);
    try {
      return await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);
  return { refreshing, pull };
}
