"use client";

import { useSearchParams } from "next/navigation";

import { PartShell } from "@/components/v3/PartShell";
import { ProfileLoadingCard } from "@/components/v3/profile/ProfileSkeleton";
import { QueueSkeleton } from "@/components/v3/queue/QueueStates";

/**
 * Загрузка «Студентов» — форма очереди: вкладки, строка инструментов и волосяные строки. Адрес с `id` или
 * `case` — это карточка лида или дела: у неё другая форма и нейтральный заголовок, а не список студентов.
 */
export default function ProfileLoading() {
  const params = useSearchParams();
  if (params.has("id") || params.has("case")) return <ProfileLoadingCard />;
  return <PartShell title="Студенты" dense><QueueSkeleton label="Загружаем список студентов…" leading={false} /></PartShell>;
}
