import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { usePortalApi } from "@/api/PortalApi";
import { orvisProfileFromAttempt } from "@/features/learning/professions/model";
import { readAssessmentAttempt, readAssessmentCatalog } from "@/features/learning/tests/api";

const key = (userKey: string, name: string, ...rest: unknown[]) => ["portal", userKey, name, ...rest] as const;

export function useAssessmentCatalog() {
  const { transport, userKey } = usePortalApi();
  return useQuery({ queryKey: key(userKey, "assessments"), queryFn: () => readAssessmentCatalog(transport), staleTime: 0 });
}

export function useAssessmentAttempt(attemptId: string | null) {
  const { transport, userKey } = usePortalApi();
  return useQuery({ queryKey: key(userKey, "assessment-attempt", attemptId), queryFn: () => readAssessmentAttempt(transport, attemptId as string), enabled: attemptId !== null, staleTime: 0, gcTime: 0 });
}

/** Топ-шкалы СОБСТВЕННОГО завершённого orvis92: для отметки «созвучно» у профессий (только клиент). */
export function useOwnTopScales() {
  const catalog = useAssessmentCatalog();
  const attemptId = catalog.data?.instruments.find((i) => i.instrumentKey === "orvis92")?.latestCompletedAttemptId ?? null;
  const attempt = useAssessmentAttempt(attemptId);
  return { topScales: attempt.data?.result?.orvis?.topScales ?? null, ready: catalog.status !== "pending" && (attemptId === null || attempt.status !== "pending") };
}

/** Профиль собственного завершённого orvis92 для «Подходят вам»; нет теста или чтение не удалось - null (блока нет). */
export function useOwnOrvisProfile() {
  const catalog = useAssessmentCatalog();
  const attemptId = catalog.data?.instruments.find((i) => i.instrumentKey === "orvis92")?.latestCompletedAttemptId ?? null;
  const attempt = useAssessmentAttempt(attemptId);
  // Профиль считается от данных попытки, не от каждого рендера (поиск перерисовывает экран на каждую букву).
  return useMemo(() => orvisProfileFromAttempt(attempt.data), [attempt.data]);
}
