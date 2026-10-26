import type { StatusTone } from "@/components/kit";

/** Синтетические заявки для страницы набора: имён и телефонов настоящих людей здесь нет (репозиторий публичный). */
export type SampleRequest = Readonly<{
  id: string;
  name: string;
  source: string;
  stage: string;
  tone: StatusTone;
  manager: string;
  received: string;
  budget: number | null;
}>;

const STAGES: readonly [string, StatusTone][] = [
  ["Новая", "info"],
  ["В работе", "neutral"],
  ["Ждём документы", "warn"],
  ["Договор подписан", "ok"],
  ["Отказ", "danger"],
];
const SOURCES = ["Сайт", "Instagram", "WhatsApp", "Рекомендация"] as const;

export const SAMPLE_REQUESTS: readonly SampleRequest[] = Array.from({ length: 27 }, (_, index) => {
  const [stage, tone] = STAGES[index % STAGES.length];
  return {
    id: `sample-${index + 1}`,
    name: `Тест Синтетический ${index + 1}`,
    source: SOURCES[index % SOURCES.length],
    stage,
    tone,
    manager: index % 3 === 0 ? "Менеджер Синтетический" : "Куратор Синтетический",
    received: `2026-10-${String((index % 27) + 1).padStart(2, "0")}`,
    budget: index % 4 === 3 ? null : 3000 + index * 150,
  };
});
