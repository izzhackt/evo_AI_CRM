// Запросы раздела «Учёба». Ключи под `["portal", userKey, …]`: выход из кабинета и смена
// студента сбрасывают кэш целиком (см. PortalApiProvider). Домашний запрос CSCA общий с
// карточкой на «Главной» (`csca-home` в api/queries.ts): после записей он перечитывается.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { usePortalApi } from "@/api/PortalApi";
import { useCscaHome } from "@/api/queries";
import { readCscaLessonV2, readCscaProgressV1, readCscaReviewV2, readCscaTestAttemptV1 } from "@/features/learning/csca/api";

const key = (userKey: string, name: string, ...rest: unknown[]) => ["portal", userKey, name, ...rest] as const;

export { useCscaHome };

export function useCscaLesson(lessonId: string) {
  const { transport, userKey } = usePortalApi();
  // Урок читается заново при каждом открытии: черновик и «пройден» берутся с сервера.
  return useQuery({ queryKey: key(userKey, "csca-lesson", lessonId), queryFn: () => readCscaLessonV2(transport, lessonId), staleTime: 0, gcTime: 0 });
}

export function useCscaProgress() {
  const { transport, userKey } = usePortalApi();
  return useQuery({ queryKey: key(userKey, "csca-progress"), queryFn: () => readCscaProgressV1(transport), staleTime: 0 });
}

export function useCscaReviewBank() {
  const { transport, userKey } = usePortalApi();
  return useQuery({ queryKey: key(userKey, "csca-review"), queryFn: () => readCscaReviewV2(transport), staleTime: 0, gcTime: 0 });
}

export function useCscaTestResult(attemptId: string | null) {
  const { transport, userKey } = usePortalApi();
  return useQuery({
    queryKey: key(userKey, "csca-attempt", attemptId),
    queryFn: () => readCscaTestAttemptV1(transport, attemptId as string),
    enabled: attemptId !== null,
    staleTime: 0,
    gcTime: 0,
  });
}

/** После записи CSCA: главная, прогресс и банк ошибок читаются заново. */
export function useInvalidateCsca() {
  const { userKey } = usePortalApi();
  const client = useQueryClient();
  return useCallback(() => {
    for (const name of ["csca-home", "csca-progress", "csca-review"]) void client.invalidateQueries({ queryKey: key(userKey, name) });
  }, [client, userKey]);
}
