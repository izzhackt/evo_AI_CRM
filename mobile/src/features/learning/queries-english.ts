// Запросы раздела «Английский».
import { useQuery } from "@tanstack/react-query";

import { usePortalApi } from "@/api/PortalApi";
import { readEnglishLesson, readEnglishModules, readEnglishReview } from "@/features/learning/english/api";

const key = (userKey: string, name: string, ...rest: unknown[]) => ["portal", userKey, name, ...rest] as const;

export function useEnglishModules() {
  const { transport, userKey } = usePortalApi();
  return useQuery({ queryKey: key(userKey, "english-modules"), queryFn: () => readEnglishModules(transport), staleTime: 0 });
}

export function useEnglishLesson(lessonId: string) {
  const { transport, userKey } = usePortalApi();
  return useQuery({ queryKey: key(userKey, "english-lesson", lessonId), queryFn: () => readEnglishLesson(transport, lessonId), staleTime: 0, gcTime: 0 });
}

export function useEnglishReview(moduleId: string | null) {
  const { transport, userKey } = usePortalApi();
  return useQuery({ queryKey: key(userKey, "english-review", moduleId), queryFn: () => readEnglishReview(transport, moduleId as string), enabled: moduleId !== null, staleTime: 0, gcTime: 0 });
}
