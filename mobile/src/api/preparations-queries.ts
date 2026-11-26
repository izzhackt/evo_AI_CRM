// Чтения экрана «Требования программы» как запросы (кэш держит последний удачный ответ). Список программ студента
// читается общим `usePreparations()` из `queries.ts`; здесь требования и состояние документов одной программы.
import { useQuery } from "@tanstack/react-query";

import { usePortalApi } from "@/api/PortalApi";
import { readApplicationReadiness } from "@/api/preparations-reads";

/** Ключ запроса программы внутри кэша студента. Общий префикс `["portal", userKey]` даёт обновление при возврате на экран. */
export const preparationKey = (userKey: string, name: string, ...rest: unknown[]) => ["portal", userKey, "preparation", name, ...rest] as const;

/**
 * Требования программы, состояние документов и готовность комплекта (`application_package_readiness_v1`).
 * Всегда устаревший (`staleTime: 0`): файлы и решения EVO меняются в любой момент, страница веба тоже `force-dynamic`.
 */
export function useApplicationReadiness(applicationId: string, enabled: boolean) {
  const { transport, studentCaseId, userKey } = usePortalApi();
  return useQuery({
    queryKey: preparationKey(userKey, "readiness", applicationId),
    queryFn: () => readApplicationReadiness(transport, studentCaseId, applicationId),
    enabled,
    staleTime: 0,
  });
}
